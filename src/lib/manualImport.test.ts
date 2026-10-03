import { describe, expect, it } from 'vitest';
import { createManualFlight } from './manualFlight';
import type { AirportSearchEntry } from './airportSearch';
import type { Flight } from '../types';
import {
  legacyFlightsToManualInputs,
  legacyFlightsToManualRecords,
  previewLegacyFlightImport,
} from './manualImport';
import { createSessionManualFlightRepository } from '../storage/sessionManualFlightRepository';
import { parseFlightFile } from './fileParser';

const entries = new Map<string, AirportSearchEntry>([
  ['ICN', {
    iata: 'ICN',
    name: 'Incheon International Airport',
    municipality: 'Seoul',
    countryCode: 'KR',
    countryName: '대한민국',
    timezoneId: 'Asia/Seoul',
  }],
  ['NRT', {
    iata: 'NRT',
    name: 'Narita International Airport',
    municipality: 'Tokyo',
    countryCode: 'JP',
    countryName: '일본',
    timezoneId: 'Asia/Tokyo',
  }],
  ['JFK', {
    iata: 'JFK',
    name: 'John F. Kennedy International Airport',
    municipality: 'New York',
    countryCode: 'US',
    countryName: '미국',
    timezoneId: 'America/New_York',
  }],
]);

function legacyFlight(date = '2025.01.21'): Flight {
  return {
    id: 0,
    type: '국제선',
    fc: '대한민국',
    tc: '일본',
    fcity: '서울',
    tcity: '도쿄',
    fa: 'ICN',
    ta: 'NRT',
    al: '샘플 항공',
    nat: '',
    fn: 'SL101',
    ac: 'B787-9',
    d: date,
    y: date ? 2025 : null,
    sortKey: date,
  };
}

describe('legacy manual import adapter', () => {
  it('imports only preflight-accepted file rows while preserving duplicates, time, and leading zeros', async () => {
    const csv = [
      '출발 공항,도착 공항,출발 일,국제선/국내선,편명',
      'ICN,NRT,2026/08/19 14:30,국제선,0012',
      'ICN,NRT,2026.02.30,국제선,INVALID-DATE',
      '??,NRT,2026.08.19,국제선,INVALID-IATA',
      'JFK,NRT,2026.03.08 02:30,국제선,DST-GAP',
      'ICN,NRT,2026/08/19 14:30,국제선,0012',
    ].join('\n');
    const catalog = { findByIata: (iata: string) => entries.get(iata) };
    const preview = previewLegacyFlightImport(await parseFlightFile(new File([csv], 'synthetic.csv')), catalog);
    expect(preview.dataRowCount).toBe(5);
    expect(preview.flights.map(({ sourceRow }) => sourceRow)).toEqual([2, 6]);
    expect(preview.diagnostics.map(({ row }) => row)).toEqual([3, 4, 5]);
    const converted = legacyFlightsToManualRecords(preview.flights, catalog, (index) => ({
      generateId: () => `file-${index}`, now: () => new Date(1787097600000 + index),
    }));
    const repository = createSessionManualFlightRepository();
    expect(await repository.merge(converted.records)).toMatchObject({ added: 2, total: 2 });
    const stored = await repository.list();
    expect(stored.map(({ id }) => id)).toEqual(['file-0', 'file-1']);
    expect(stored.every(({ date, departureTime, flightNumber }) => date === '2026-08-19' && departureTime === '14:30' && flightNumber === '0012')).toBe(true);
  });

  it('preflights every parsed row and reports domain failures before confirmation', () => {
    const valid = { ...legacyFlight(), sourceRow: 3 };
    const invalidDate = { ...legacyFlight('2025.02.30'), sourceRow: 4 };
    const sameAirport = { ...legacyFlight(), ta: 'ICN', sourceRow: 5 };
    const gap = { ...legacyFlight('2026.03.08'), fa: 'JFK', departureTime: '02:30', sourceRow: 6 };
    const unresolved = { ...legacyFlight(), fa: 'ZZZ', ta: 'YYY', fc: '', tc: '', typeSource: 'fallback' as const, sourceRow: 7 };
    const parsed = {
      flights: [valid, invalidDate, sameAirport, gap, unresolved, { ...valid, sourceRow: 9 }],
      err: null,
      dataRowCount: 7,
      diagnostics: [{ row: 8, message: 'Invalid IATA' }],
    };
    const preview = previewLegacyFlightImport(parsed, { findByIata: (iata) => entries.get(iata) });
    expect(preview.dataRowCount).toBe(7);
    expect(preview.flights.map((flight) => flight.sourceRow)).toEqual([3, 9]);
    expect(preview.diagnostics.map(({ row }) => row)).toEqual([4, 5, 6, 7, 8]);
    expect(preview.diagnostics.every(({ message }) => message.length > 0)).toBe(true);
    // Duplicate flights remain legitimate; source data and parser diagnostics are untouched.
    expect(parsed.flights).toHaveLength(6);
    expect(parsed.diagnostics).toHaveLength(1);
  });

  it('does not disguise unexpected catalog failures as skipped rows', () => {
    expect(() => previewLegacyFlightImport({ flights: [legacyFlight()], err: null }, {
      findByIata: () => { throw new Error('catalog unavailable'); },
    })).toThrow('catalog unavailable');
  });

  it('converts parser output into snapshot-rich manual inputs', () => {
    const result = legacyFlightsToManualInputs(
      [legacyFlight()],
      { findByIata: (iata) => entries.get(iata) },
    );
    expect(result.skipped).toBe(0);
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0]).toMatchObject({
      date: '2025-01-21',
      type: '국제선',
      airline: '샘플 항공',
      departure: {
        iata: 'ICN',
        municipality: '서울',
        countryCode: 'KR',
        timezoneId: 'Asia/Seoul',
      },
      arrival: {
        iata: 'NRT',
        municipality: '도쿄',
        countryCode: 'JP',
        timezoneId: 'Asia/Tokyo',
      },
    });
    expect(result.inputs[0].departure.latitude).not.toBeNull();
    expect(result.inputs[0].arrival.longitude).not.toBeNull();
  });

  it('preserves an optional parsed departure time in the session input', () => {
    const result = legacyFlightsToManualInputs(
      [{ ...legacyFlight('2026.08.19'), departureTime: '14:30' }],
      { findByIata: (iata) => entries.get(iata) },
    );
    expect(result.inputs[0]).toMatchObject({
      date: '2026-08-19',
      departureTime: '14:30',
    });
  });

  it('skips a DST-gap row while retaining valid siblings for one atomic merge', async () => {
    const gap = {
      ...legacyFlight('2026.03.08'),
      fa: 'JFK',
      fc: '미국',
      fcity: '뉴욕',
      departureTime: '02:30',
      sortKey: '2026.03.08 02:30',
      y: 2026,
    };
    const valid = {
      ...legacyFlight('2026.08.19'),
      departureTime: '14:30',
      sortKey: '2026.08.19 14:30',
      y: 2026,
    };
    const converted = legacyFlightsToManualRecords(
      [gap, valid],
      { findByIata: (iata) => entries.get(iata) },
      (index) => ({
        generateId: () => `imported-${index}`,
        now: () => new Date(`2026-08-19T00:00:0${index}.000Z`),
      }),
    );

    expect(converted.skipped).toBe(1);
    expect(converted.records).toHaveLength(1);
    expect(converted.records[0]).toMatchObject({
      id: 'imported-1',
      date: '2026-08-19',
      departureTime: '14:30',
    });

    const currentPage = createSessionManualFlightRepository();
    await currentPage.replaceAll([createManualFlight({
      ...converted.records[0],
      date: '2026-08-18',
    }, {
      generateId: () => 'existing',
      now: () => new Date('2026-08-18T00:00:00.000Z'),
    })]);
    const merged = await currentPage.merge(converted.records);
    expect(merged).toMatchObject({ added: 1, updated: 0, skipped: 0, total: 2 });
    expect((await currentPage.list()).map(({ id }) => id)).toEqual([
      'existing',
      'imported-1',
    ]);
  });

  it('reports rows without a stable date instead of silently changing their day', () => {
    const result = legacyFlightsToManualInputs(
      [legacyFlight('')],
      { findByIata: (iata) => entries.get(iata) },
    );
    expect(result).toEqual({ inputs: [], skipped: 1 });
  });

  it('skips unresolved rows whose parser classification was only a fallback', () => {
    const unresolved = {
      ...legacyFlight(),
      fa: 'ZZZ',
      ta: 'YYY',
      fc: '',
      tc: '',
      typeSource: 'fallback' as const,
    };
    const result = legacyFlightsToManualInputs(
      [unresolved],
      { findByIata: () => undefined },
    );
    expect(result).toEqual({ inputs: [], skipped: 1 });
  });

  it('retains an explicit type for unresolved historical airports', () => {
    const unresolved = {
      ...legacyFlight(),
      fa: 'ZZZ',
      ta: 'YYY',
      fc: '',
      tc: '',
      type: '국내선' as const,
      typeSource: 'explicit' as const,
    };
    const result = legacyFlightsToManualInputs(
      [unresolved],
      { findByIata: () => undefined },
    );
    expect(result.skipped).toBe(0);
    expect(result.inputs[0].type).toBe('국내선');
  });

  it('keeps converted CSV records only in the current page session', async () => {
    const conversion = legacyFlightsToManualInputs(
      [legacyFlight()],
      { findByIata: (iata) => entries.get(iata) },
    );
    const currentPage = createSessionManualFlightRepository();
    const incoming = conversion.inputs.map((value, index) => createManualFlight(value, {
      generateId: () => `imported-${index}`,
      now: () => new Date('2025-01-22T00:00:00Z'),
    }));
    await currentPage.merge(incoming);

    expect(await currentPage.list()).toHaveLength(1);
    expect((await currentPage.list())[0]).toMatchObject({
      departure: { iata: 'ICN' },
      arrival: { iata: 'NRT' },
    });

    const refreshedPage = createSessionManualFlightRepository();
    expect(await refreshedPage.list()).toEqual([]);
  });
});
