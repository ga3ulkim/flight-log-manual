import { describe, expect, it } from 'vitest';
import { parseDateInfo, parseIata } from './dateIata';

describe('parseDateInfo', () => {
  it('returns the reference missing-date sentinel when no supported year exists', () => {
    expect(parseDateInfo('not a date')).toEqual({
      y: null,
      d: '',
      sortKey: '9999.99.99',
    });
  });

  it('normalizes dotted dates for display and chronological sorting', () => {
    expect(parseDateInfo('2098.3.7 09:15')).toEqual({
      y: 2098,
      d: '2098.03.07',
      sortKey: '2098.03.07',
    });
  });

  it('recognizes Korean month and day markers', () => {
    expect(parseDateInfo('2097년 11월 2일')).toEqual({
      y: 2097,
      d: '2097.11.02',
      sortKey: '2097.11.02',
    });
  });

  it('retains year-only precision without inventing a display month or day', () => {
    expect(parseDateInfo('planned in 2096')).toEqual({
      y: 2096,
      d: '2096',
      sortKey: '2096.00.00',
    });
  });
});

describe('parseIata', () => {
  it('uppercases a bare code', () => {
    expect(parseIata('icn')).toBe('ICN');
  });

  it('extracts a standalone code from an airport label', () => {
    expect(parseIata('Synthetic Alpha Airport (nrt)')).toBe('NRT');
  });

  it('returns the first standalone code when a cell contains multiple codes', () => {
    expect(parseIata('ICN / NRT')).toBe('ICN');
  });

  it('rejects letters embedded inside a longer token', () => {
    expect(parseIata('ABCDE')).toBeNull();
    expect(parseIata('')).toBeNull();
  });
});
