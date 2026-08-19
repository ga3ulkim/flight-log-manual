import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import type { Flight } from '../types';
import {
  estimateFlightDurationMinutes,
  estimateFlightTiming,
  formatEstimatedDurationKo,
  resolveDepartureLocalDateTime,
} from './flightTiming';
import { haversine } from './geography';

type Coordinates = readonly [number, number];

const COORDINATES = {
  PUS: [35.1795, 128.9382],
  CJU: [33.5113, 126.493],
  ICN: [37.4602, 126.4407],
  NRT: [35.772, 140.3929],
  SIN: [1.3502, 103.994],
  LAX: [33.9425, -118.4081],
  LHR: [51.4706, -0.4619],
  JFK: [40.6399, -73.7787],
} as const satisfies Record<string, Coordinates>;

function flight(
  from: keyof typeof COORDINATES,
  to: keyof typeof COORDINATES,
  overrides: Partial<Flight> = {},
): Flight {
  return {
    id: 1,
    type: '국제선',
    fc: '',
    tc: '',
    fcity: '',
    tcity: '',
    fa: from,
    ta: to,
    al: '',
    nat: '',
    fn: '',
    ac: '',
    d: '2026.08.19',
    y: 2026,
    sortKey: '2026.08.19',
    departureTime: '14:30',
    departureTimeZoneId: from === 'LAX' ? 'America/Los_Angeles' : 'Asia/Seoul',
    arrivalTimeZoneId: to === 'LAX' ? 'America/Los_Angeles' : 'Asia/Seoul',
    ...overrides,
    departureSnapshot: {
      latitude: COORDINATES[from][0],
      longitude: COORDINATES[from][1],
    },
    arrivalSnapshot: {
      latitude: COORDINATES[to][0],
      longitude: COORDINATES[to][1],
    },
  } as Flight;
}

function routeDuration(from: keyof typeof COORDINATES, to: keyof typeof COORDINATES): number {
  return estimateFlightDurationMinutes(haversine(COORDINATES[from], COORDINATES[to]));
}

describe('estimated flight duration', () => {
  it('is deterministic, monotonic across representative bands, and symmetric', () => {
    const shortDomestic = routeDuration('PUS', 'CJU');
    const shortInternational = routeDuration('ICN', 'NRT');
    const medium = routeDuration('ICN', 'SIN');
    const longPacific = routeDuration('ICN', 'LAX');
    const longAtlantic = routeDuration('LHR', 'JFK');

    expect(shortDomestic).toBeGreaterThanOrEqual(45);
    expect(shortDomestic).toBeLessThan(90);
    expect(shortInternational).toBeGreaterThan(shortDomestic);
    expect(shortInternational).toBeLessThan(180);
    expect(medium).toBeGreaterThan(300);
    expect(medium).toBeLessThan(450);
    expect(longPacific).toBeGreaterThan(600);
    expect(longPacific).toBeLessThan(900);
    expect(longAtlantic).toBeGreaterThan(360);
    expect(longAtlantic).toBeLessThan(600);
    expect(routeDuration('LAX', 'ICN')).toBe(longPacific);
    expect(routeDuration('ICN', 'LAX')).toBe(routeDuration('ICN', 'LAX'));
  });

  it('enforces a sensible minimum and rejects invalid distances', () => {
    expect(estimateFlightDurationMinutes(0)).toBe(45);
    expect(() => estimateFlightDurationMinutes(-1)).toThrow(RangeError);
    expect(() => estimateFlightDurationMinutes(Number.NaN)).toThrow(RangeError);
    expect(formatEstimatedDurationKo(715)).toBe('11시간 55분');
  });
});

describe('timezone-aware estimated arrival', () => {
  it('handles both directions across the International Date Line', () => {
    const westbound = estimateFlightTiming(flight('ICN', 'LAX'));
    expect(westbound).toMatchObject({
      status: 'available',
      departure: { date: '2026.08.19', time: '14:30', timeZoneId: 'Asia/Seoul' },
      arrival: { date: '2026.08.19', timeZoneId: 'America/Los_Angeles' },
    });
    if (westbound.status === 'available') {
      expect(westbound.arrival.time < westbound.departure.time).toBe(true);
    }

    const eastbound = estimateFlightTiming(flight('LAX', 'ICN', {
      departureTimeZoneId: 'America/Los_Angeles',
      arrivalTimeZoneId: 'Asia/Seoul',
    }));
    expect(eastbound).toMatchObject({
      status: 'available',
      departure: { date: '2026.08.19', time: '14:30' },
      arrival: { date: '2026.08.20', timeZoneId: 'Asia/Seoul' },
    });
  });

  it('rolls the date in one timezone and respects destination DST', () => {
    const domestic = estimateFlightTiming(flight('PUS', 'CJU', {
      d: '2026.08.19',
      departureTime: '23:50',
      departureTimeZoneId: 'Asia/Seoul',
      arrivalTimeZoneId: 'Asia/Seoul',
    }));
    expect(domestic).toMatchObject({
      status: 'available',
      arrival: { date: '2026.08.20', time: '00:45' },
    });

    const beforeUsSpringChange = estimateFlightTiming(flight('LHR', 'JFK', {
      d: '2026.03.08',
      departureTime: '00:30',
      departureTimeZoneId: 'Europe/London',
      arrivalTimeZoneId: 'America/New_York',
    }));
    expect(beforeUsSpringChange).toMatchObject({
      status: 'available',
      arrival: { date: '2026.03.08', timeZoneId: 'America/New_York' },
    });
    if (beforeUsSpringChange.status === 'available') {
      // Arrival occurs after New York has moved from UTC-5 to UTC-4.
      expect(beforeUsSpringChange.arrival.time).toBe('03:35');
    }
  });

  it('rejects spring-forward gaps and chooses the earlier fall-back instant', () => {
    expect(resolveDepartureLocalDateTime(
      '2026-03-08',
      '02:30',
      'America/New_York',
    )).toEqual({ status: 'invalid', reason: 'nonexistent_local_time' });

    const overlap = resolveDepartureLocalDateTime(
      '2026-11-01',
      '01:30',
      'America/New_York',
    );
    expect(overlap).toMatchObject({ status: 'valid', ambiguous: true });
    if (overlap.status === 'valid') {
      expect(Temporal.Instant.fromEpochNanoseconds(overlap.epochNanoseconds).toString())
        .toBe('2026-11-01T05:30:00Z');
    }
  });

  it('keeps duration but gracefully omits an unavailable arrival clock', () => {
    expect(estimateFlightTiming(flight('ICN', 'LAX', {
      departureTime: undefined,
    }))).toMatchObject({
      status: 'unavailable',
      reason: 'missing_departure_time',
      durationMinutes: expect.any(Number),
    });
    expect(estimateFlightTiming(flight('ICN', 'LAX', {
      arrivalTimeZoneId: undefined,
    }))).toMatchObject({
      status: 'unavailable',
      reason: 'missing_timezone',
      durationMinutes: expect.any(Number),
    });
  });
});
