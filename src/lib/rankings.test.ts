import { describe, expect, it } from 'vitest';
import type { RankingEntry } from '../types';
import { DEFAULT_RANKING_LIMIT, rankingDisclosure } from './rankings';

function entries(count: number, prefix = 'Synthetic'): RankingEntry[] {
  return Array.from(
    { length: count },
    (_, index) => [`${prefix} ${index + 1}`, count - index] as const,
  );
}

describe('rankingDisclosure', () => {
  it('keeps the empty state free of a disclosure control', () => {
    expect(rankingDisclosure([], false)).toEqual({
      entries: [],
      total: 0,
      canToggle: false,
    });
  });

  it('shows every entry for one through nine results without a control', () => {
    const rankings = entries(9);
    const disclosure = rankingDisclosure(rankings, false);
    expect(disclosure.entries).toEqual(rankings);
    expect(disclosure.canToggle).toBe(false);
  });

  it('shows exactly ten results without an unnecessary control', () => {
    const rankings = entries(DEFAULT_RANKING_LIMIT);
    const disclosure = rankingDisclosure(rankings, false);
    expect(disclosure.entries).toHaveLength(10);
    expect(disclosure.canToggle).toBe(false);
  });

  it('initially limits eleven or more results to the first ten in order', () => {
    const rankings = entries(13);
    const disclosure = rankingDisclosure(rankings, false);
    expect(disclosure.entries).toEqual(rankings.slice(0, 10));
    expect(disclosure.total).toBe(13);
    expect(disclosure.canToggle).toBe(true);
  });

  it('expands to every result and collapses back to Top 10', () => {
    const rankings = entries(17);
    expect(rankingDisclosure(rankings, true).entries).toEqual(rankings);
    expect(rankingDisclosure(rankings, false).entries).toEqual(rankings.slice(0, 10));
  });

  it('uses the selected category data while preserving one shared expansion state', () => {
    const countries = entries(12, 'Country');
    const airlines = entries(8, 'Airline');
    const expanded = true;

    expect(rankingDisclosure(countries, expanded)).toMatchObject({
      entries: countries,
      total: 12,
      canToggle: true,
    });
    expect(rankingDisclosure(airlines, expanded)).toMatchObject({
      entries: airlines,
      total: 8,
      canToggle: false,
    });
    expect(rankingDisclosure(countries, expanded).entries).toEqual(countries);
  });
});
