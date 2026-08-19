import { describe, expect, it } from 'vitest';
import { makeFlight } from '../testFixtures';
import {
  aggregateFlights,
  aggregateLiveFlights,
  rankingData,
  routeKey,
  topAirportLabels,
} from './analytics';

describe('flight analytics', () => {
  const flights = [
    makeFlight({
      id: 0,
      type: '국내선',
      fc: 'Synthetic Republic A',
      tc: 'Synthetic Republic A',
      fcity: 'Alpha City',
      tcity: 'Gamma City',
      fa: 'ICN',
      ta: 'CJU',
      al: 'Example Airways',
    }),
    makeFlight({
      id: 1,
      fcity: 'Gamma City',
      tcity: 'Alpha City',
      fa: 'CJU',
      ta: 'ICN',
      al: 'Example Airways',
    }),
    makeFlight({
      id: 2,
      fcity: 'Alpha City',
      tcity: 'Delta City',
      fa: 'ICN',
      ta: 'NRT',
      al: 'Alternate Air',
    }),
  ];

  it('aggregates airport visits and retains the first known city label', () => {
    const analytics = aggregateFlights(flights);
    expect(analytics.apUse.get('ICN')).toEqual({ n: 3, city: 'Alpha City' });
    expect(analytics.apUse.get('CJU')).toEqual({ n: 2, city: 'Gamma City' });
    expect(analytics.apUse.get('NRT')).toEqual({ n: 1, city: 'Delta City' });
  });

  it('counts each country at most once per flight', () => {
    const analytics = aggregateFlights(flights);
    expect(analytics.countries).toEqual(
      new Set(['Synthetic Republic A', 'Synthetic Republic B']),
    );
    expect(analytics.cCount.get('Synthetic Republic A')).toBe(3);
    expect(analytics.cCount.get('Synthetic Republic B')).toBe(2);
  });

  it('ranks operating airlines by count', () => {
    const rankings = rankingData(aggregateFlights(flights), '항공사');
    expect(rankings).toEqual([
      ['Example Airways', 2],
      ['Alternate Air', 1],
    ]);
  });

  it('returns the complete sorted ranking so presentation can own the Top 10 limit', () => {
    const airlineCounts = new Map(
      Array.from({ length: 13 }, (_, index) => [
        `Synthetic Carrier ${index + 1}`,
        13 - index,
      ]),
    );
    const rankings = rankingData(
      {
        cCount: new Map<string, number>(),
        cities: new Map<string, number>(),
        apUse: new Map<string, { n: number; city: string }>(),
        alCount: airlineCounts,
      },
      '항공사',
    );

    expect(rankings).toHaveLength(13);
    expect(rankings[0]).toEqual(['Synthetic Carrier 1', 13]);
    expect(rankings[12]).toEqual(['Synthetic Carrier 13', 1]);
  });

  it('aggregates an undirected route while retaining its first direction', () => {
    const route = aggregateFlights(flights).routes.get(routeKey('ICN', 'CJU'));
    expect(route).toMatchObject({ a: 'ICN', b: 'CJU', n: 2, intl: false });
    expect(route?.items.map((flight) => flight.id)).toEqual([0, 1]);
  });

  it('builds city-prefixed airport rankings', () => {
    const rankings = rankingData(aggregateFlights(flights), '공항');
    expect(rankings[0]).toEqual(['Alpha City ICN', 3]);
  });

  it('reports unknown airports without dropping their usage counts', () => {
    const analytics = aggregateFlights([
      makeFlight({ fa: 'ZZZ', ta: 'ICN', fcity: 'Unknown City' }),
    ]);
    expect(analytics.unknown).toEqual(['ZZZ']);
    expect(analytics.apUse.get('ZZZ')?.n).toBe(1);
    expect(analytics.km).toBe(0);
  });

  it('selects the busiest known airports for low-zoom labels', () => {
    expect(topAirportLabels(aggregateFlights(flights)).slice(0, 3)).toEqual([
      'ICN',
      'CJU',
      'NRT',
    ]);
  });

  it('applies current-flight progress only to the final live distance', () => {
    const completed = aggregateLiveFlights(flights.slice(0, 2), 1, 1);
    const halfway = aggregateLiveFlights(flights.slice(0, 2), 1, 0.5);
    expect(completed).not.toBeNull();
    expect(halfway).not.toBeNull();
    expect(halfway!.count).toBe(2);
    expect(halfway!.km).toBeLessThan(completed!.km);
    expect(halfway!.airports).toBe(2);
  });
});
