import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { createManualFlight, updateManualFlight } from './manualFlight';
import type { ManualAirportSnapshot, ManualFlightInput, ManualFlightRecord } from './manualFlight';
import {
  MANUAL_BACKUP_FORMAT,
  ManualBackupValidationError,
  createManualFlightBackup,
  exportManualFlightBackup,
  manualBackupFileName,
  parseManualFlightBackup,
  restoreManualFlightBackup,
  serializeManualFlightBackup,
  validateManualFlightBackup,
} from './manualBackup';
import {
  MANUAL_CSV_HEADERS,
  exportManualFlightsCsv,
  manualCsvFileName,
} from './manualCsv';
import { parseWorkbook } from './parser';
import {
  InMemoryManualFlightRepository,
  createSessionManualFlightRepository,
} from '../storage/sessionManualFlightRepository';

function airport(
  iata: string,
  countryCode: string,
  latitude: number,
  longitude: number,
): ManualAirportSnapshot {
  return {
    iata,
    name: `${iata} "Archive", Airport`,
    municipality: `${iata} City`,
    countryCode,
    countryName: `Country ${countryCode}`,
    latitude,
    longitude,
  };
}

function input(overrides: Partial<ManualFlightInput> = {}): ManualFlightInput {
  return {
    date: '2025-01-21',
    departure: airport('ICN', 'KR', 37.4602, 126.4407),
    arrival: airport('NRT', 'JP', 35.772, 140.3929),
    airline: 'Example Airways',
    flightNumber: 'EX 703',
    aircraft: 'B787-9',
    ...overrides,
  };
}

function saved(
  id: string,
  timestamp = '2025-02-01T00:00:00Z',
  overrides: Partial<ManualFlightInput> = {},
): ManualFlightRecord {
  return createManualFlight(input(overrides), {
    generateId: () => id,
    now: () => new Date(timestamp),
  });
}

function repository(): InMemoryManualFlightRepository {
  return createSessionManualFlightRepository({
    generateId: () => 'generated',
    now: () => new Date('2025-01-01T00:00:00Z'),
  });
}

describe('manual JSON backup', () => {
  it('exports a versioned format and round-trips every airport snapshot field', () => {
    const flight = saved('round-trip');
    const backup = createManualFlightBackup([flight], () => new Date('2026-08-19T01:02:03Z'));
    const parsed = parseManualFlightBackup(serializeManualFlightBackup(backup));

    expect(parsed).toEqual(backup);
    expect(parsed).toMatchObject({
      format: MANUAL_BACKUP_FORMAT,
      schemaVersion: 1,
      flightSchemaVersion: 1,
      exportedAt: '2026-08-19T01:02:03.000Z',
    });
    expect(parsed.flights[0].departure).toEqual(flight.departure);
  });

  it('rejects invalid JSON, identifiers, future versions, records, coordinates, and duplicate IDs', () => {
    expect(() => parseManualFlightBackup('{nope')).toThrowError(ManualBackupValidationError);
    expect(() => validateManualFlightBackup({
      format: 'something-else',
    })).toThrowError(/백업 파일이 아닙니다/);

    const valid = createManualFlightBackup([saved('one')]);
    expect(() => validateManualFlightBackup({ ...valid, schemaVersion: 2 })).toThrowError(
      /지원하지 않는 JSON 백업 버전/,
    );
    expect(() => validateManualFlightBackup({ ...valid, flightSchemaVersion: 2 })).toThrowError(
      /스키마 버전/,
    );
    expect(() => validateManualFlightBackup({
      ...valid,
      flights: [{ ...valid.flights[0], date: '2025-02-30' }],
    })).toThrowError(/날짜/);
    expect(() => validateManualFlightBackup({
      ...valid,
      flights: [{
        ...valid.flights[0],
        departure: { ...valid.flights[0].departure, latitude: 100 },
      }],
    })).toThrowError(/-90에서 90/);
    expect(() => validateManualFlightBackup({
      ...valid,
      flights: [valid.flights[0], valid.flights[0]],
    })).toThrowError(/중복/);
  });

  it('restores with replace semantics only after validation', async () => {
    const repo = repository();
    await repo.replaceAll([saved('old')]);
    const incoming = [saved('new-1'), saved('new-2', '2025-02-02T00:00:00Z')];
    const backup = createManualFlightBackup(incoming);

    expect(await restoreManualFlightBackup(repo, backup, 'replace')).toEqual({
      mode: 'replace',
      previousTotal: 1,
      added: 2,
      updated: 0,
      skipped: 0,
      total: 2,
    });
    expect((await repo.list()).map((flight) => flight.id)).toEqual(['new-1', 'new-2']);

    await expect(restoreManualFlightBackup(repo, '{invalid', 'replace')).rejects.toThrow();
    expect((await repo.list()).map((flight) => flight.id)).toEqual(['new-1', 'new-2']);
  });

  it('merges stable IDs using newer-updatedAt wins and avoids silent duplication', async () => {
    const repo = repository();
    const original = saved('shared', '2025-01-01T00:00:00Z');
    await repo.replaceAll([original]);
    const newer = updateManualFlight(original, input({ aircraft: 'A350-900' }), {
      now: () => new Date('2025-04-01T00:00:00Z'),
    });
    const backup = createManualFlightBackup([newer, saved('additional')]);

    expect(await restoreManualFlightBackup(repo, backup, 'merge')).toEqual({
      mode: 'merge',
      previousTotal: 1,
      added: 1,
      updated: 1,
      skipped: 0,
      total: 2,
    });
    expect((await repo.get('shared'))?.aircraft).toBe('A350-900');

    const olderBackup = createManualFlightBackup([original]);
    const skipped = await restoreManualFlightBackup(repo, olderBackup, 'merge');
    expect(skipped).toMatchObject({ added: 0, updated: 0, skipped: 1, total: 2 });
  });

  it('exports current-session records and restored records do not cross a page reinitialization', async () => {
    const currentPage = repository();
    const restored = saved('restored-session-only');
    const backup = createManualFlightBackup([restored]);
    await restoreManualFlightBackup(currentPage, backup, 'replace');

    expect(await exportManualFlightBackup(
      currentPage,
      () => new Date('2026-08-19T00:00:00Z'),
    )).toMatchObject({
      exportedAt: '2026-08-19T00:00:00.000Z',
      flights: [restored],
    });
    expect(exportManualFlightsCsv(await currentPage.list())).toContain('Example Airways');

    const refreshedPage = repository();
    expect(await refreshedPage.list()).toEqual([]);
  });

  it('uses human-recognizable local-date filenames', () => {
    const localDate = new Date(2026, 7, 19, 12);
    expect(manualBackupFileName(localDate)).toBe('flight-log-backup-2026-08-19.json');
    expect(manualCsvFileName(localDate)).toBe('flight-log-2026-08-19.csv');
  });
});

describe('manual CSV export', () => {
  it('includes a UTF-8 BOM and fields recognized by the existing parser', () => {
    const csv = exportManualFlightsCsv([saved('csv-1')]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    for (const header of MANUAL_CSV_HEADERS) expect(csv).toContain(header);

    const parsed = parseWorkbook(XLSX.read(csv, { type: 'string' }));
    expect(parsed.err).toBeNull();
    expect(parsed.flights).toHaveLength(1);
    expect(parsed.flights[0]).toMatchObject({
      type: '국제선',
      fc: 'Country KR',
      tc: 'Country JP',
      fcity: 'ICN City',
      tcity: 'NRT City',
      fa: 'ICN',
      ta: 'NRT',
      al: 'Example Airways',
      fn: 'EX 703',
      ac: 'B787-9',
      d: '2025.01.21',
      sortKey: '2025.01.21',
    });
  });

  it('escapes commas and quotes without losing airport IATA codes', () => {
    const csv = exportManualFlightsCsv([saved('csv-quotes')], { includeBom: false });
    expect(csv).toContain('"ICN · ICN ""Archive"", Airport"');
    const parsed = parseWorkbook(XLSX.read(csv, { type: 'string' }));
    expect(parsed.flights[0]).toMatchObject({ fa: 'ICN', ta: 'NRT' });
  });

  it('puts IATA first so an airport-name acronym cannot replace the real code', () => {
    const departure = airport('BZZ', 'GB', 51.75, -1.58);
    departure.name = 'RAF Brize Norton';
    const csv = exportManualFlightsCsv([
      saved('csv-bzz', '2025-02-01T00:00:00Z', { departure }),
    ], { includeBom: false });

    expect(csv).toContain('BZZ · RAF Brize Norton');
    const parsed = parseWorkbook(XLSX.read(csv, { type: 'string' }));
    expect(parsed.err).toBeNull();
    expect(parsed.flights[0]).toMatchObject({ fa: 'BZZ', ta: 'NRT' });
  });

  it('neutralizes formula-leading user text for spreadsheet safety', () => {
    const csv = exportManualFlightsCsv([
      saved('csv-formula', '2025-02-01T00:00:00Z', {
        airline: '=HYPERLINK("https://invalid.example")',
        flightNumber: '+1+1',
        aircraft: '@SUM(1,1)',
      }),
    ], { includeBom: false });

    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+1+1");
    expect(csv).toContain("'@SUM");
    expect(csv).not.toContain(',=HYPERLINK');
    expect(csv).not.toContain(',+1+1,');
    expect(csv).not.toContain(',@SUM');
  });
});
