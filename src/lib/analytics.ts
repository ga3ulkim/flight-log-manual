import type {
  AirportUsage,
  Flight,
  FlightAnalytics,
  FlightFilter,
  LiveFlightAnalytics,
  RankingEntry,
  RouteRecord,
  RouteKey,
  StatTab,
  YearFilter,
} from '../types';
import { hasKnownAirport, haversine, knownAirport } from './geography';

type RankingSource = Pick<
  FlightAnalytics | LiveFlightAnalytics,
  'apUse' | 'cCount' | 'cities' | 'alCount'
>;

export function routeKey(fromAirport: string, toAirport: string): RouteKey {
  return [fromAirport, toAirport].sort().join('|');
}

export function availableYears(flights: readonly Flight[]): number[] {
  return [
    ...new Set(
      flights.map((flight) => flight.y).filter((value): value is number => value != null),
    ),
  ].sort((a, b) => a - b);
}

export function filterFlights(
  flights: readonly Flight[],
  year: YearFilter,
  type: FlightFilter,
): Flight[] {
  return flights.filter(
    (flight) =>
      (year === 'all' || flight.y === year) &&
      (type === 'all' || flight.type === type),
  );
}

function addAirportUsage(
  airportUsage: Map<string, AirportUsage>,
  code: string,
  city: string,
): void {
  const current = airportUsage.get(code) || { n: 0, city: '' };
  current.n += 1;
  if (city && !current.city) current.city = city;
  airportUsage.set(code, current);
}

function addCount(counts: Map<string, number>, value: string): void {
  if (value) counts.set(value, (counts.get(value) || 0) + 1);
}

export function aggregateFlights(flights: readonly Flight[]): FlightAnalytics {
  const routes = new Map<RouteKey, RouteRecord>();
  const apUse = new Map<string, AirportUsage>();
  const unknown = new Set<string>();
  const countries = new Set<string>();
  const cities = new Map<string, number>();
  const cCount = new Map<string, number>();
  const alCount = new Map<string, number>();
  let km = 0;
  let intl = 0;
  let dom = 0;

  flights.forEach((flight) => {
    if (flight.type === '국내선') dom += 1;
    else intl += 1;

    const airportVisits: readonly [string, string][] = [
      [flight.fa, flight.fcity],
      [flight.ta, flight.tcity],
    ];
    airportVisits.forEach(([code, city]) => {
      addAirportUsage(apUse, code, city);
      if (!hasKnownAirport(code)) unknown.add(code);
    });

    const countriesInFlight = new Set([flight.fc, flight.tc].filter(Boolean));
    countriesInFlight.forEach((country) => {
      countries.add(country);
      addCount(cCount, country);
    });
    [flight.fcity, flight.tcity].forEach((city) => addCount(cities, city));
    addCount(alCount, flight.al);

    if (flight.fa !== flight.ta) {
      const key = routeKey(flight.fa, flight.ta);
      const current = routes.get(key) || {
        a: flight.fa,
        b: flight.ta,
        n: 0,
        intl: flight.type === '국제선',
        items: [],
      };
      current.n += 1;
      current.items.push(flight);
      routes.set(key, current);
    }

    if (hasKnownAirport(flight.fa) && hasKnownAirport(flight.ta)) {
      km += haversine(knownAirport(flight.fa), knownAirport(flight.ta));
    }
  });

  return {
    routes,
    apUse,
    unknown: [...unknown],
    km: Math.round(km),
    intl,
    dom,
    countries,
    cities,
    cCount,
    alCount,
  };
}

export function aggregateLiveFlights(
  sequence: readonly Flight[],
  currentIndex: number,
  progress: number,
): LiveFlightAnalytics | null {
  if (currentIndex < 0 || sequence.length === 0) return null;

  const flights = sequence.slice(0, Math.min(currentIndex, sequence.length - 1) + 1);
  const apUse = new Map<string, AirportUsage>();
  const countries = new Set<string>();
  const cities = new Map<string, number>();
  const cCount = new Map<string, number>();
  const alCount = new Map<string, number>();
  let km = 0;
  let intl = 0;
  let dom = 0;

  flights.forEach((flight, index) => {
    if (flight.type === '국내선') dom += 1;
    else intl += 1;

    addAirportUsage(apUse, flight.fa, flight.fcity);
    addAirportUsage(apUse, flight.ta, flight.tcity);

    const countriesInFlight = new Set([flight.fc, flight.tc].filter(Boolean));
    countriesInFlight.forEach((country) => {
      countries.add(country);
      addCount(cCount, country);
    });
    [flight.fcity, flight.tcity].forEach((city) => addCount(cities, city));
    addCount(alCount, flight.al);

    const fullDistance = haversine(knownAirport(flight.fa), knownAirport(flight.ta));
    km += index === flights.length - 1 ? fullDistance * Math.max(0, Math.min(1, progress)) : fullDistance;
  });

  return {
    count: flights.length,
    km: Math.round(km),
    countries: countries.size,
    airports: apUse.size,
    intl,
    dom,
    apUse,
    cCount,
    cities,
    alCount,
  };
}

export function rankingData(source: RankingSource, tab: StatTab): RankingEntry[] {
  const counts =
    tab === '국가'
      ? source.cCount
      : tab === '도시'
        ? source.cities
        : tab === '항공사'
          ? source.alCount
          : new Map(
              [...source.apUse].map(([code, usage]) => [
                `${usage.city ? `${usage.city} ` : ''}${code}`,
                usage.n,
              ]),
            );

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1]);
}

export function activeRankingNames(
  analytics: LiveFlightAnalytics,
  flight: Flight,
  tab: StatTab,
): Set<string> {
  if (tab === '국가') return new Set([flight.fc, flight.tc].filter(Boolean));
  if (tab === '도시') return new Set([flight.fcity, flight.tcity].filter(Boolean));
  if (tab === '항공사') return new Set([flight.al].filter(Boolean));

  const airportLabel = (code: string): string => {
    const usage = analytics.apUse.get(code);
    return `${usage?.city ? `${usage.city} ` : ''}${code}`;
  };
  return new Set([airportLabel(flight.fa), airportLabel(flight.ta)]);
}

export function topAirportLabels(analytics: FlightAnalytics): string[] {
  return [...analytics.apUse.entries()]
    .filter(([code]) => hasKnownAirport(code))
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 12)
    .map(([code]) => code);
}
