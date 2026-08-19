import { describe, expect, it } from 'vitest';
import {
  EXPECTED_AIRPORT_COLUMNS,
  buildAirportIndex,
  formatGeneratedAirportSearchModule,
  resolveAirportTimeZone,
  resolveDuplicateIata,
  validateAirportIndex,
  validateAirportSearchIndex,
} from './airport-data.mjs';

function csv(rows, columns = EXPECTED_AIRPORT_COLUMNS) {
  const values = [columns, ...rows].map((row) =>
    row.map((value) => JSON.stringify(String(value))).join(','),
  );
  return `${values.join('\n')}\n`;
}

function airportRow(overrides = {}) {
  const record = {
    id: '1',
    ident: 'SYN1',
    type: 'medium_airport',
    name: 'Synthetic Test Airport',
    latitude_deg: '37.5',
    longitude_deg: '127.0',
    iso_country: 'ZZ',
    municipality: 'Test City',
    scheduled_service: 'yes',
    iata_code: 'TST',
    ...overrides,
  };
  return EXPECTED_AIRPORT_COLUMNS.map((column) => record[column] ?? '');
}

describe('OurAirports generation', () => {
  it('rejects a changed upstream schema', () => {
    const columns = EXPECTED_AIRPORT_COLUMNS.filter(
      (column) => column !== 'longitude_deg',
    );
    expect(() => buildAirportIndex(csv([], columns))).toThrow(/longitude_deg/);
  });

  it('filters missing IATA codes and invalid coordinates', () => {
    const result = buildAirportIndex(
      csv([
        airportRow(),
        airportRow({ id: '2', ident: 'SYN2', iata_code: '' }),
        airportRow({ id: '3', ident: 'SYN3', iata_code: 'BAD', latitude_deg: '91' }),
        airportRow({ id: '4', ident: 'SYN4', iata_code: 'TOO-LONG' }),
      ]),
    );

    expect(result.airports).toEqual({ TST: [37.5, 127] });
    expect(result.searchEntries).toEqual([
      ['TST', 'Synthetic Test Airport', 'Test City', 'ZZ'],
    ]);
    expect(result.stats).toMatchObject({
      airportCount: 1,
      missingIata: 1,
      invalidIata: 1,
      invalidCoordinates: 1,
    });
  });

  it('reports and deterministically resolves a uniquely ranked duplicate', () => {
    const result = buildAirportIndex(
      csv([
        airportRow({ id: '1', ident: 'LOW', scheduled_service: 'no', latitude_deg: '1' }),
        airportRow({ id: '2', ident: 'HIGH', scheduled_service: 'yes', latitude_deg: '2' }),
      ]),
    );

    expect(result.airports.TST).toEqual([2, 127]);
    expect(result.duplicateReports).toEqual([
      expect.objectContaining({
        code: 'TST',
        selectedIdent: 'HIGH',
        reason: expect.stringContaining('priority'),
      }),
    ]);
  });

  it('fails a genuinely ambiguous duplicate instead of choosing silently', () => {
    const candidates = [
      {
        id: '1', ident: 'SYN1', type: 'medium_airport', scheduledService: 'yes',
        latitude: 1, longitude: 2,
      },
      {
        id: '2', ident: 'SYN2', type: 'medium_airport', scheduledService: 'yes',
        latitude: 3, longitude: 4,
      },
    ];
    expect(() => resolveDuplicateIata('TST', candidates)).toThrow(/Ambiguous/);
  });

  it('honors a reviewed explicit duplicate selection', () => {
    const candidates = [
      {
        id: '1', ident: 'SYN1', type: 'medium_airport', scheduledService: 'yes',
        latitude: 1, longitude: 2,
      },
      {
        id: '2', ident: 'SYN2', type: 'medium_airport', scheduledService: 'yes',
        latitude: 3, longitude: 4,
      },
    ];
    expect(
      resolveDuplicateIata('TST', candidates, { TST: 'SYN2' }).selected.ident,
    ).toBe('SYN2');
  });

  it('validates generated code ordering and coordinate ranges', () => {
    expect(validateAirportIndex({ AAA: [0, 0], BBB: [90, 180] })).toBe(2);
    expect(() => validateAirportIndex({ AAA: [Number.NaN, 0] })).toThrow(
      /Invalid generated coordinates/,
    );
    expect(() => validateAirportIndex({ BBB: [0, 0], AAA: [0, 0] })).toThrow(
      /not sorted/,
    );
  });

  it('validates search metadata against the coordinate snapshot', () => {
    const rows = [
      ['AAA', 'Alpha Airport', 'Alpha City', 'KR'],
      ['BBB', 'Bravo Airport', '', 'GB'],
    ];
    const coordinates = { AAA: [1, 2], BBB: [3, 4] };

    expect(validateAirportSearchIndex(rows, coordinates)).toBe(2);
    expect(() => validateAirportSearchIndex(rows, coordinates, {
      requireTimezones: true,
    })).toThrow(/timezone is missing/);
    expect(() =>
      validateAirportSearchIndex([...rows].reverse()),
    ).toThrow(/not sorted/);
    expect(() =>
      validateAirportSearchIndex(rows.slice(0, 1), coordinates),
    ).toThrow(/different sizes/);
    expect(() =>
      validateAirportSearchIndex(
        [['AAA', 'Alpha Airport', 'Alpha City', 'KOR']],
        { AAA: [1, 2] },
      ),
    ).toThrow(/ISO country/);
  });

  it('formats a compact typed search module with provenance', () => {
    const generated = formatGeneratedAirportSearchModule(
      [['TST', 'Synthetic Test Airport', 'Test City', 'ZZ', 'Etc/UTC']],
      'search-digest',
    );

    expect(generated).toContain('GENERATED_AIRPORT_SEARCH_COUNT = 1');
    expect(generated).toContain('OURAIRPORTS_SEARCH_SHA256 = "search-digest"');
    expect(generated).toContain('AIRPORT_TIMEZONE_RESOLVER = "geo-tz@8.1.8/all"');
    expect(generated).toContain('AIRPORT_TIMEZONE_BOUNDARY_RELEASE = "2026c"');
    expect(generated).toContain('AIRPORT_TIMEZONE_BOUNDARY_LICENSE = "ODbL-1.0"');
    expect(generated).toContain(
      '["TST","Synthetic Test Airport","Test City","ZZ","Etc/UTC"]',
    );
    expect(generated).not.toContain('latitude');
  });

  it('resolves one timezone and requires a reviewed choice for multi-hit coordinates', () => {
    expect(resolveAirportTimeZone('TST', 1, 2, () => ['Asia/Seoul'])).toEqual({
      timezoneId: 'Asia/Seoul',
      candidates: ['Asia/Seoul'],
    });
    expect(() => resolveAirportTimeZone(
      'TST',
      1,
      2,
      () => ['Asia/Shanghai', 'Asia/Urumqi'],
    )).toThrow(/Ambiguous timezone/);
    expect(resolveAirportTimeZone(
      'TST',
      1,
      2,
      () => ['Asia/Urumqi', 'Asia/Shanghai', 'Asia/Urumqi'],
      { TST: 'Asia/Shanghai' },
    )).toEqual({
      timezoneId: 'Asia/Shanghai',
      candidates: ['Asia/Urumqi', 'Asia/Shanghai'],
    });
  });

  it('rejects zero-hit, invalid, and stale explicit timezone resolutions', () => {
    expect(() => resolveAirportTimeZone('TST', 1, 2, () => [])).toThrow(/no timezone/);
    expect(() => resolveAirportTimeZone('TST', 1, 2, () => ['+09:00']))
      .toThrow(/invalid IANA/);
    expect(() => resolveAirportTimeZone(
      'TST',
      1,
      2,
      () => ['Asia/Seoul', 'Asia/Tokyo'],
      { TST: 'Europe/London' },
    )).toThrow(/is not among/);
    expect(() => resolveAirportTimeZone(
      'TST',
      1,
      2,
      () => ['Asia/Seoul'],
      { TST: 'Asia/Seoul' },
    )).toThrow(/Stale timezone selection/);

    expect(() => buildAirportIndex(csv([airportRow()]), {
      timeZoneResolver: () => ['Asia/Seoul'],
      timezoneSelections: { OLD: 'Asia/Seoul' },
    })).toThrow(/unknown airport codes: OLD/);
  });

  it('adds resolved timezone metadata and reports multi-zone selections', () => {
    const result = buildAirportIndex(csv([airportRow()]), {
      timeZoneResolver: () => ['Asia/Seoul', 'Asia/Tokyo'],
      timezoneSelections: { TST: 'Asia/Seoul' },
    });
    expect(result.searchEntries).toEqual([
      ['TST', 'Synthetic Test Airport', 'Test City', 'ZZ', 'Asia/Seoul'],
    ]);
    expect(result.stats).toMatchObject({
      timezoneResolved: 1,
      timezoneUnresolved: 0,
      timezoneMultiple: 1,
    });
  });
});
