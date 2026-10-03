import { afterEach, describe, expect, it } from 'vitest';
import { makeFlight } from '../testFixtures';
import { aggregateFlights, aggregateLiveFlights } from './analytics';
import { estimateFlightDurationMinutes, estimateFlightTiming } from './flightTiming';
import { haversine, setRuntimeAirportCoordinates } from './geography';
import { chronologicalFlights, flightDuration, journeyDuration } from './playback';

afterEach(() => setRuntimeAirportCoordinates({}));

describe('per-flight snapshot coordinates', () => {
  const short = Object.assign(makeFlight({ id: 1, fa: 'ZZZ', ta: 'YYY' }), {
    departureSnapshot: { latitude: 0, longitude: 0 },
    arrivalSnapshot: { latitude: 0, longitude: 1 },
  });
  const long = Object.assign(makeFlight({ id: 2, fa: 'ZZZ', ta: 'YYY', departureTime: '12:00',
    departureTimeZoneId: 'Etc/UTC', arrivalTimeZoneId: 'Etc/UTC', d: '2026.08.19' }), {
    departureSnapshot: { latitude: 0, longitude: 0 },
    arrivalSnapshot: { latitude: 0, longitude: 100 },
  });

  it('uses each saved coordinate for totals, live distance and playback pacing', () => {
    setRuntimeAirportCoordinates({ ZZZ: [0, 0], YYY: [0, 1] });
    const shortKm = haversine([0, 0], [0, 1]);
    const longKm = haversine([0, 0], [0, 100]);
    expect(aggregateFlights([short, long]).km).toBe(Math.round(shortKm + longKm));
    expect(aggregateLiveFlights([short, long], 1, 0.5)?.km).toBe(Math.round(shortKm + longKm * 0.5));
    expect(flightDuration(long)).toBe(journeyDuration(longKm));
    expect(estimateFlightTiming(long).durationMinutes).toBe(estimateFlightDurationMinutes(longKm));
  });

  it('does not fill an explicitly missing saved coordinate from another record', () => {
    setRuntimeAirportCoordinates({ ZZZ: [0, 0], YYY: [0, 1] });
    const missing = { ...long, arrivalSnapshot: { latitude: null, longitude: null } };
    expect(chronologicalFlights([short, missing]).map(({ id }) => id)).toEqual([1]);
    expect(aggregateFlights([missing])).toMatchObject({ km: 0, unknown: ['YYY'] });
    expect(estimateFlightTiming(missing)).toEqual({ status: 'unavailable', reason: 'missing_coordinates' });
  });
});
