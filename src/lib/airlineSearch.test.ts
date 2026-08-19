import { describe, expect, it } from 'vitest';
import {
  MAX_AIRLINE_SEARCH_LIMIT,
  createAirlineSearchCatalog,
  loadAirlineSearchCatalog,
  searchAirlines,
  type AirlineSearchTuple,
} from './airlineSearch';
import {
  GENERATED_AIRLINE_COUNT,
  GENERATED_AIRLINE_SEARCH_INDEX,
} from '../data/generated/airlines';

const FIXTURE_AIRLINES = [
  ['Air Berlin', ['AB'], ['BER'], 'Germany', ['airberlin']],
  ['All Nippon Airways', ['NH'], ['ANA'], 'Japan', ['ANA']],
  ['Korean Air', ['KE'], ['KAL'], 'South Korea', [
    'Korean Air Lines',
    'Korean Airlines',
  ]],
  ['Northwest Airlines', ['NW'], ['NWA'], 'United States', [
    'Northwest Orient Airlines',
  ]],
  ['Synthetic Airways', ['S1', 'ZZ'], ['SYN'], 'Test Country', ['Test Air']],
  ['Twin Air', [], [], 'Northland', []],
  ['Twin Air', ['T2'], ['TWN'], 'Southland', []],
] as const satisfies readonly AirlineSearchTuple[];

describe('airline search', () => {
  const catalog = createAirlineSearchCatalog(FIXTURE_AIRLINES);

  it('ranks exact IATA, ICAO, canonical name, and alias matches deterministically', () => {
    expect(catalog.search('KE')[0]?.name).toBe('Korean Air');
    expect(catalog.search('KAL')[0]?.name).toBe('Korean Air');
    expect(catalog.search('Korean Air')[0]?.name).toBe('Korean Air');
    expect(catalog.search('Korean Air Lines')[0]?.name).toBe('Korean Air');
  });

  it('matches case-insensitive prefixes, substrings, and every retained code', () => {
    expect(catalog.search('korean')[0]?.name).toBe('Korean Air');
    expect(catalog.search('orient')[0]?.name).toBe('Northwest Airlines');
    expect(catalog.search('zz')[0]).toMatchObject({
      name: 'Synthetic Airways',
      iata: 'ZZ',
      icao: 'SYN',
    });
    expect(catalog.search('Synthetic Airways')[0]).toMatchObject({
      name: 'Synthetic Airways',
      iata: '',
      icao: 'SYN',
    });
  });

  it('finds an exact normalized canonical display name', () => {
    expect(catalog.findByCanonicalName('  KOREAN   AIR  ')).toMatchObject({
      name: 'Korean Air',
      iata: 'KE',
      icao: 'KAL',
      country: 'South Korea',
    });
    expect(catalog.findByCanonicalName('Korean Air Lines')).toBeUndefined();
  });

  it('does not collapse duplicate names and rehydrates them by saved identity', () => {
    expect(catalog.findByCanonicalName('Twin Air')).toBeUndefined();
    expect(catalog.findBySnapshot({
      name: 'Twin Air',
      iata: 'T2',
      icao: 'TWN',
    })).toMatchObject({
      name: 'Twin Air',
      iata: 'T2',
      icao: 'TWN',
      country: 'Southland',
    });
    expect(catalog.findBySnapshot({
      name: 'Twin Air',
      iata: '',
      icao: '',
      country: 'Northland',
    })).toMatchObject({
      name: 'Twin Air',
      iata: '',
      icao: '',
      country: 'Northland',
    });
    expect(catalog.findBySnapshot({ name: 'Twin Air' })).toBeUndefined();
  });

  it('returns no forced value for blank or unknown free text', () => {
    expect(catalog.search('')).toEqual([]);
    expect(catalog.search('User Typed Charter')).toEqual([]);
  });

  it('honors caller limits and caps rendering work', () => {
    const many = Array.from({ length: 100 }, (_, index) => [
      `Airline ${String(index).padStart(3, '0')}`,
      [],
      [],
      '',
      [],
    ] as const);
    expect(searchAirlines(many, 'airline', 3)).toHaveLength(3);
    expect(searchAirlines(many, 'airline', 10_000)).toHaveLength(
      MAX_AIRLINE_SEARCH_LIMIT,
    );
    expect(searchAirlines(many, 'airline', 0)).toEqual([]);
  });
});

describe('generated airline search snapshot', () => {
  it('contains representative current and eligible historic carriers', () => {
    expect(GENERATED_AIRLINE_COUNT).toBeGreaterThan(1_000);
    expect(GENERATED_AIRLINE_SEARCH_INDEX).toHaveLength(GENERATED_AIRLINE_COUNT);

    const names = new Set<string>(
      GENERATED_AIRLINE_SEARCH_INDEX.map(([name]) => name),
    );
    expect(names.has('Korean Air')).toBe(true);
    expect(names.has('Air Berlin')).toBe(true);
    expect(names.has('Northwest Airlines')).toBe(true);
    // Q8681 currently has English `Pan Am` and multilingual
    // `Pan American World Airways` labels; both must stay out after its precise
    // 1991 cessation. PA/PAA cannot be asserted absent because Wikidata also
    // assigns them to a different, eligible 1998-2004 carrier.
    expect(names.has('Pan Am')).toBe(false);
    expect(names.has('Pan American World Airways')).toBe(false);
  });

  it('loads through the lazy boundary and searches canonical names and codes', async () => {
    const generatedCatalog = await loadAirlineSearchCatalog();
    expect(generatedCatalog.size).toBe(GENERATED_AIRLINE_COUNT);
    expect(generatedCatalog.search('KE')[0]).toMatchObject({
      name: 'Korean Air',
      iata: 'KE',
      icao: 'KAL',
      country: 'South Korea',
    });
    expect(generatedCatalog.search('Korean Air Lines')[0]?.name).toBe('Korean Air');
    expect(generatedCatalog.search('AB')[0]?.name).toBe('Air Berlin');
    expect(generatedCatalog.search('NWA')[0]?.name).toBe('Northwest Airlines');
    expect(generatedCatalog.search('VF')[0]).toMatchObject({
      name: 'AJet',
      iata: 'VF',
      icao: '',
    });
    expect(generatedCatalog.search('TKJ')[0]).toMatchObject({
      name: 'AJet',
      iata: '',
      icao: 'TKJ',
    });
  });
});
