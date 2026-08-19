import { describe, expect, it } from 'vitest';
import { makeFlight } from '../testFixtures';
import {
  groupFlightsForTimeline,
  timelineDateLabel,
  timelineDisclosure,
} from './timeline';

describe('groupFlightsForTimeline', () => {
  it('groups dated flights by descending year and date for archive browsing', () => {
    const groups = groupFlightsForTimeline([
      makeFlight({ id: 1, y: 2097, d: '2097.08.20', sortKey: '2097.08.20' }),
      makeFlight({ id: 2, y: 2099, d: '2099.01.03', sortKey: '2099.01.03' }),
      makeFlight({ id: 3, y: 2099, d: '2099.11.04', sortKey: '2099.11.04' }),
      makeFlight({ id: 4, y: 2098, d: '2098.02.10', sortKey: '2098.02.10' }),
    ]);

    expect(groups.map((group) => group.year)).toEqual([2099, 2098, 2097]);
    expect(groups[0].flights.map((flight) => flight.id)).toEqual([3, 2]);
  });

  it('uses reverse source order as the same-day tie-break without mutating input', () => {
    const input = [
      makeFlight({ id: 10, sortKey: '2099.04.02', d: '2099.04.02' }),
      makeFlight({ id: 11, sortKey: '2099.04.02', d: '2099.04.02' }),
    ];

    expect(groupFlightsForTimeline(input)[0].flights.map((flight) => flight.id)).toEqual([
      11,
      10,
    ]);
    expect(input.map((flight) => flight.id)).toEqual([10, 11]);
  });

  it('keeps undated records in an honest final group', () => {
    const groups = groupFlightsForTimeline([
      makeFlight({ id: 1, y: null, d: '', sortKey: '9999.99.99' }),
      makeFlight({ id: 2, y: 2099, d: '2099', sortKey: '2099.00.00' }),
    ]);

    expect(groups.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: '2099', label: '2099' },
      { key: 'unknown', label: '날짜 미상' },
    ]);
    expect(groups[1].flights[0].d).toBe('');
  });

  it('operates only on the supplied filter-ready subset', () => {
    const filteredFlights = [
      makeFlight({ id: 7, y: 2098, type: '국내선' }),
      makeFlight({ id: 9, y: 2098, type: '국내선' }),
    ];

    const groups = groupFlightsForTimeline(filteredFlights);

    expect(groups).toHaveLength(1);
    expect(groups[0].flights).toHaveLength(2);
    expect(groups[0].flights.every((flight) => flight.type === '국내선')).toBe(true);
  });
});

describe('timelineDateLabel', () => {
  it('formats full, partial, and missing dates without adding precision', () => {
    expect(timelineDateLabel(makeFlight({ d: '2099.01.16' }))).toEqual({
      primary: 'JAN 16',
      dateTime: '2099-01-16',
      accessible: '2099.01.16',
    });
    expect(timelineDateLabel(makeFlight({ d: '2099' }))).toEqual({
      primary: '연도만 기록',
      dateTime: '2099',
      accessible: '2099',
    });
    expect(timelineDateLabel(makeFlight({ d: '', y: null }))).toEqual({
      primary: '—',
      accessible: '날짜 미상',
    });
  });
});

describe('timelineDisclosure', () => {
  const matchingFlights = [
    makeFlight({ id: 1, y: 2098, d: '2098.04.01', sortKey: '2098.04.01' }),
    makeFlight({ id: 2, y: 2099, d: '2099.01.10', sortKey: '2099.01.10' }),
    makeFlight({ id: 3, y: 2099, d: '2099.08.20', sortKey: '2099.08.20' }),
  ];

  it('shows only the most recent matching flight while collapsed', () => {
    const disclosure = timelineDisclosure(matchingFlights, false);

    expect(disclosure.canToggle).toBe(true);
    expect(disclosure.groups).toHaveLength(1);
    expect(disclosure.groups[0].flights.map((flight) => flight.id)).toEqual([3]);
  });

  it('shows every matching record while expanded', () => {
    const disclosure = timelineDisclosure(matchingFlights, true);

    expect(disclosure.canToggle).toBe(true);
    expect(disclosure.groups.flatMap((group) => group.flights)).toHaveLength(3);
    expect(disclosure.groups.map((group) => group.year)).toEqual([2099, 2098]);
  });

  it('returns to one newest record when collapsed again', () => {
    expect(
      timelineDisclosure(matchingFlights, true).groups.flatMap((group) => group.flights),
    ).toHaveLength(3);
    expect(
      timelineDisclosure(matchingFlights, false).groups.flatMap((group) => group.flights),
    ).toHaveLength(1);
  });

  it('does not require a disclosure control for exactly one result', () => {
    const disclosure = timelineDisclosure([matchingFlights[1]], false);

    expect(disclosure.canToggle).toBe(false);
    expect(disclosure.groups[0].flights).toEqual([matchingFlights[1]]);
  });

  it('preserves the existing empty result', () => {
    expect(timelineDisclosure([], false)).toEqual({ groups: [], canToggle: false });
  });

  it('uses only the supplied filtered data for its newest preview', () => {
    const domestic2099 = [
      makeFlight({
        id: 7,
        type: '국내선',
        y: 2099,
        d: '2099.02.01',
        sortKey: '2099.02.01',
      }),
      makeFlight({
        id: 8,
        type: '국내선',
        y: 2099,
        d: '2099.06.01',
        sortKey: '2099.06.01',
      }),
    ];

    const preview = timelineDisclosure(domestic2099, false).groups[0].flights[0];
    expect(preview.id).toBe(8);
    expect(preview.type).toBe('국내선');
    expect(preview.y).toBe(2099);
  });
});
