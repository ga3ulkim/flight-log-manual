import { describe, expect, it } from 'vitest';
import type { AirportSearchEntry } from './airportSearch';
import type { Flight } from '../types';
import { legacyFlightsToManualInputs } from './manualImport';

const entries = new Map<string, AirportSearchEntry>([
  ['ICN', {
    iata: 'ICN',
    name: 'Incheon International Airport',
    municipality: 'Seoul',
    countryCode: 'KR',
    countryName: '대한민국',
  }],
  ['NRT', {
    iata: 'NRT',
    name: 'Narita International Airport',
    municipality: 'Tokyo',
    countryCode: 'JP',
    countryName: '일본',
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
      },
      arrival: {
        iata: 'NRT',
        municipality: '도쿄',
        countryCode: 'JP',
      },
    });
    expect(result.inputs[0].departure.latitude).not.toBeNull();
    expect(result.inputs[0].arrival.longitude).not.toBeNull();
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
});
