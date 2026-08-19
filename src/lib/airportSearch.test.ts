import { describe, expect, it } from 'vitest';
import {
  MAX_AIRPORT_SEARCH_LIMIT,
  createAirportSearchCatalog,
  loadAirportSearchCatalog,
  searchAirports,
  type AirportSearchTuple,
} from './airportSearch';
import {
  GENERATED_AIRPORT_SEARCH_COUNT,
  GENERATED_AIRPORT_SEARCH_INDEX,
} from '../data/generated/airportSearch';
import { GENERATED_AIRPORT_COORDINATES } from '../data/generated/ourAirports';
import { REVIEWED_KOREAN_AIRPORT_ALIASES } from './airportSearchAliases.ko';

const FIXTURE_AIRPORTS = [
  ['GMP', 'Gimpo International Airport', 'Seoul', 'KR'],
  ['ICN', 'Incheon International Airport', 'Seoul', 'KR'],
  ['ICA', 'Icabaru Airport', 'Icabaru', 'VE'],
  ['LHR', 'London Heathrow Airport', 'London', 'GB'],
  ['SEA', 'Seattle-Tacoma International Airport', 'Seattle', 'US'],
  ['SEL', 'Seletar Airport', 'Singapore', 'SG'],
  ['TST', 'Sea View Test Airport', 'Test City', 'ZZ'],
] as const satisfies readonly AirportSearchTuple[];

function countryName(countryCode: string, locale: string): string | undefined {
  const names: Record<string, Record<string, string>> = {
    KR: { ko: '대한민국', en: 'South Korea' },
    GB: { ko: '영국', en: 'United Kingdom' },
    US: { ko: '미국', en: 'United States' },
  };
  return names[countryCode]?.[locale];
}

describe('airport search', () => {
  const catalog = createAirportSearchCatalog(FIXTURE_AIRPORTS, {
    countryLocales: ['ko', 'en'],
    resolveCountryName: countryName,
  });

  it('puts an exact IATA match ahead of name matches', () => {
    const results = catalog.search('sea');
    expect(results[0].iata).toBe('SEA');
    expect(results.some(({ iata }) => iata === 'TST')).toBe(true);
  });

  it('puts IATA prefixes ahead of textual matches', () => {
    expect(catalog.search('ic').slice(0, 2).map(({ iata }) => iata)).toEqual([
      'ICA',
      'ICN',
    ]);
  });

  it('matches airport names and municipalities', () => {
    expect(catalog.search('heathrow')[0].iata).toBe('LHR');
    expect(catalog.search('seoul').map(({ iata }) => iata)).toEqual([
      'GMP',
      'ICN',
    ]);
  });

  it('ranks exact Korean aliases, alias prefixes, then canonical matches', () => {
    const rankedCatalog = createAirportSearchCatalog([
      ...FIXTURE_AIRPORTS,
      ['SEO', '서울', 'Canonical City', 'KR'],
    ], {
      countryLocales: ['ko'],
      resolveCountryName: countryName,
      aliases: [
        { alias: '서울', iatas: ['ICN'] },
        { alias: '서울동부', iatas: ['GMP'] },
      ],
    });

    expect(rankedCatalog.search('서울').slice(0, 3).map(({ iata }) => iata))
      .toEqual(['ICN', 'GMP', 'SEO']);
  });

  it('uses the reviewed Korean overlay without inventing missing airports', () => {
    const localizedCatalog = createAirportSearchCatalog(FIXTURE_AIRPORTS, {
      countryLocales: ['ko', 'en'],
      resolveCountryName: countryName,
      aliases: REVIEWED_KOREAN_AIRPORT_ALIASES,
    });

    expect(localizedCatalog.search('인천').map(({ iata }) => iata)).toEqual(['ICN']);
    expect(localizedCatalog.search('서울').map(({ iata }) => iata)).toEqual([
      'ICN',
      'GMP',
    ]);
    expect(localizedCatalog.search('도쿄')).toEqual([]);
    expect(catalog.search('인천')).toEqual([]);
  });

  it('matches ISO, Korean, and English country names', () => {
    expect(catalog.search('KR').map(({ iata }) => iata)).toEqual(['GMP', 'ICN']);
    expect(catalog.search('대한민국').map(({ iata }) => iata)).toEqual([
      'GMP',
      'ICN',
    ]);
    expect(catalog.search('south korea').map(({ iata }) => iata)).toEqual([
      'GMP',
      'ICN',
    ]);
    expect(catalog.findByIata(' icn ')?.countryName).toBe('대한민국');
  });

  it('returns no suggestions for a blank query or a zero limit', () => {
    expect(catalog.search('   ')).toEqual([]);
    expect(catalog.search('airport', 0)).toEqual([]);
  });

  it('honors requested limits and enforces a hard rendering bound', () => {
    const many = Array.from({ length: 100 }, (_, index) => {
      const first = String.fromCharCode(65 + Math.floor(index / 26));
      const second = String.fromCharCode(65 + (index % 26));
      return [`A${first}${second}`, `Airport ${index}`, `City ${index}`, 'US'] as const;
    });

    expect(searchAirports(many, 'airport', 3)).toHaveLength(3);
    expect(searchAirports(many, 'airport', 10_000)).toHaveLength(
      MAX_AIRPORT_SEARCH_LIMIT,
    );
  });

  it('keeps repeated searches responsive with a 9,000-row catalog', () => {
    const airports = Array.from({ length: 9_000 }, (_, index) => {
      const first = String.fromCharCode(65 + Math.floor(index / (26 * 26)));
      const second = String.fromCharCode(65 + (Math.floor(index / 26) % 26));
      const third = String.fromCharCode(65 + (index % 26));
      return [
        `${first}${second}${third}`,
        `Synthetic Airport ${index}`,
        `City ${index % 200}`,
        'KR',
      ] as const;
    });
    const largeCatalog = createAirportSearchCatalog(airports, {
      countryLocales: ['en'],
      resolveCountryName: () => 'South Korea',
    });

    const startedAt = performance.now();
    for (let index = 0; index < 40; index += 1) {
      expect(largeCatalog.search('airport', 8)).toHaveLength(8);
    }
    expect(performance.now() - startedAt).toBeLessThan(1_500);
  });
});

describe('generated airport search snapshot', () => {
  it('is a comprehensive one-to-one companion to the coordinate index', () => {
    const coordinateCodes = Object.keys(GENERATED_AIRPORT_COORDINATES);
    expect(GENERATED_AIRPORT_SEARCH_COUNT).toBeGreaterThan(8_000);
    expect(GENERATED_AIRPORT_SEARCH_INDEX).toHaveLength(
      GENERATED_AIRPORT_SEARCH_COUNT,
    );
    expect(coordinateCodes).toHaveLength(GENERATED_AIRPORT_SEARCH_COUNT);

    let previousCode = '';
    GENERATED_AIRPORT_SEARCH_INDEX.forEach(
      ([iata, name, municipality, countryCode, timezoneId], index) => {
        expect(iata).toMatch(/^[A-Z]{3}$/);
        expect(iata > previousCode).toBe(true);
        expect(iata).toBe(coordinateCodes[index]);
        expect(name.trim().length).toBeGreaterThan(0);
        expect(typeof municipality).toBe('string');
        expect(countryCode).toMatch(/^[A-Z]{2}$/);
        expect(timezoneId).toMatch(/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/);
        previousCode = iata;
      },
    );
  });

  it('can be loaded through the lazy catalog boundary', async () => {
    const generatedCatalog = await loadAirportSearchCatalog();
    expect(generatedCatalog.size).toBe(GENERATED_AIRPORT_SEARCH_COUNT);
    expect(generatedCatalog.search('ICN')[0]).toMatchObject({
      iata: 'ICN',
      countryCode: 'KR',
    });
    expect(generatedCatalog.search('Incheon')[0]?.iata).toBe('ICN');
    expect(generatedCatalog.search('LAX')[0]?.iata).toBe('LAX');
    expect(generatedCatalog.search('인천')[0]?.iata).toBe('ICN');
    expect(generatedCatalog.search('서울').slice(0, 2).map(({ iata }) => iata))
      .toEqual(['ICN', 'GMP']);
    expect(generatedCatalog.search('김포')[0]?.iata).toBe('GMP');
    expect(generatedCatalog.search('부산')[0]?.iata).toBe('PUS');
    expect(generatedCatalog.search('김해')[0]?.iata).toBe('PUS');
    expect(generatedCatalog.search('제주')[0]?.iata).toBe('CJU');
    expect(generatedCatalog.search('로스앤젤레스')[0]?.iata).toBe('LAX');
    expect(generatedCatalog.search('앤젤')[0]?.iata).toBe('LAX');
    expect(generatedCatalog.search('인천국')[0]?.iata).toBe('ICN');
    expect(generatedCatalog.search('도쿄').slice(0, 2).map(({ iata }) => iata))
      .toEqual(['HND', 'NRT']);
    expect(generatedCatalog.search('오사카').slice(0, 2).map(({ iata }) => iata))
      .toEqual(['KIX', 'ITM']);
    expect(generatedCatalog.search('서울', 1)).toHaveLength(1);
  });

  it('retains representative build-time IANA timezone metadata', async () => {
    const generatedCatalog = await loadAirportSearchCatalog();
    const expected = {
      ICN: 'Asia/Seoul',
      LAX: 'America/Los_Angeles',
      NRT: 'Asia/Tokyo',
      JFK: 'America/New_York',
      LHR: 'Europe/London',
      SIN: 'Asia/Singapore',
    } as const;
    for (const [iata, timezoneId] of Object.entries(expected)) {
      expect(generatedCatalog.findByIata(iata)?.timezoneId).toBe(timezoneId);
    }
  });
});
