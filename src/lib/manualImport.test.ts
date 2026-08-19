import { describe, expect, it } from 'vitest';
import { createManualFlight } from './manualFlight';
import type { AirportSearchEntry } from './airportSearch';
import type { Flight } from '../types';
import {
  legacyFlightsToManualInputs,
  legacyFlightsToManualRecords,
} from './manualImport';
import { createSessionManualFlightRepository } from '../storage/sessionManualFlightRepository';

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
