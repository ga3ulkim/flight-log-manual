import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { estimateFlightTiming, formatEstimatedDurationKo } from '../lib/flightTiming';
import { makeFlight } from '../testFixtures';
import type { RouteRecord } from '../types';
import FlightTimeline from './FlightTimeline';
import PlaybackUI from './PlaybackUI';
import RouteDetail from './RouteDetail';

const timedFlight = makeFlight({
  id: 14,
  fa: 'ICN',
  ta: 'LAX',
  d: '2026.08.19',
  y: 2026,
  sortKey: '2026.08.19 14:30',
  departureTime: '14:30',
  departureTimeZoneId: 'Asia/Seoul',
  arrivalTimeZoneId: 'America/Los_Angeles',
});

const followingFlight = makeFlight({
  id: 15,
  fa: 'LAX',
  ta: 'SFO',
  d: '2026.08.20',
  y: 2026,
  sortKey: '2026.08.20',
});

function playbackMarkup(hold = 0, currentFlight = timedFlight): string {
  return renderToStaticMarkup(
    <PlaybackUI
      play={{ on: true, idx: 0, t: hold ? 1 : 0.45, hold, holdTotal: hold ? 2_000 : 0, speed: 1 }}
      active
      currentFlight={currentFlight}
      nextFlight={followingFlight}
      transferMode={hold ? 'land' : null}
      sequenceLength={2}
      onToggle={() => undefined}
      onStop={() => undefined}
      onCycleSpeed={() => undefined}
    />,
  );
}

describe('saved and estimated time presentation', () => {
  it('shows timezone-aware departure, arrival, and duration on aircraft playback', () => {
    const timing = estimateFlightTiming(timedFlight);
    expect(timing.status).toBe('available');
    if (timing.status !== 'available') return;

    const markup = playbackMarkup();
    expect(markup).toContain('비행 현지 시각 추정');
    expect(markup).toContain('출발 · ICN');
    expect(markup).toContain(`${timing.departure.date} ${timing.departure.time}`);
    expect(markup).toContain('예상 도착 · LAX');
    expect(markup).toContain(`${timing.arrival.date} ${timing.arrival.time}`);
    expect(markup).toContain(formatEstimatedDurationKo(timing.durationMinutes));
    expect(markup).toContain('LOCAL');
  });

  it('never carries aircraft timing into a transfer card', () => {
    const markup = playbackMarkup(1_000);
    expect(markup).toContain('지상 이동 → LAX');
    expect(markup).not.toContain('비행 현지 시각 추정');
    expect(markup).not.toContain('예상 도착');
    expect(markup).not.toContain('예상 비행시간');
    expect(markup).not.toContain('LOCAL');
  });

  it('shows only the saved local departure time in the timeline and route detail', () => {
    const timeline = renderToStaticMarkup(<FlightTimeline flights={[timedFlight]} />);
    const route: RouteRecord = {
      a: 'ICN',
      b: 'LAX',
      n: 1,
      intl: true,
      items: [timedFlight],
    };
    const detail = renderToStaticMarkup(
      <RouteDetail route={route} distanceKm={9_600} onClose={() => undefined} />,
    );

    for (const markup of [timeline, detail]) {
      expect(markup).toContain('14:30');
      expect(markup).toContain('LOCAL');
      expect(markup).not.toContain('예상 도착');
      expect(markup).not.toContain('예상 비행시간');
    }
    expect(timeline).toContain('aria-label="출발 공항 현지 시각 14:30"');
    expect(detail).toContain('aria-label="출발 공항 현지 시각 14:30"');
  });

  it('does not invent a displayed time when the record has none', () => {
    const untimedFlight = makeFlight({
      ...timedFlight,
      departureTime: undefined,
      sortKey: '2026.08.19',
    });
    const timeline = renderToStaticMarkup(<FlightTimeline flights={[untimedFlight]} />);
    const playback = playbackMarkup(0, untimedFlight);
    expect(timeline).not.toContain('LOCAL');
    expect(timeline).not.toContain('출발 공항 현지 시각');
    expect(playback).not.toContain('비행 현지 시각 추정');
    expect(playback).not.toContain('예상 도착');
  });

  it('orders route-detail rows by same-day time, then keeps untimed rows stable', () => {
    const early = makeFlight({
      ...timedFlight,
      id: 32,
      departureTime: '08:10',
      sortKey: '2026.08.19 08:10',
      fn: 'EARLY',
    });
    const late = makeFlight({
      ...timedFlight,
      id: 30,
      departureTime: '19:40',
      sortKey: '2026.08.19 19:40',
      fn: 'LATE',
    });
    const untimed = makeFlight({
      ...timedFlight,
      id: 31,
      departureTime: undefined,
      sortKey: '2026.08.19',
      fn: 'UNTIMED',
    });
    const markup = renderToStaticMarkup(
      <RouteDetail
        route={{ a: 'ICN', b: 'LAX', n: 3, intl: true, items: [untimed, late, early] }}
        distanceKm={9_600}
        onClose={() => undefined}
      />,
    );

    expect(markup.indexOf('EARLY')).toBeLessThan(markup.indexOf('LATE'));
    expect(markup.indexOf('LATE')).toBeLessThan(markup.indexOf('UNTIMED'));
  });
});
