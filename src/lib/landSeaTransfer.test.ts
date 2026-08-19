import { describe, expect, it } from 'vitest';
import type { LandGeometry, LandPolygon } from '../data/landGeometry';
import { knownAirport } from './geography';
import {
  geographicPoint,
  isPointOnLand,
  mergeTinyTransferSegments,
  segmentTransferByLand,
  shortestLongitudeDelta,
  transferModeAt,
  transferPointAt,
  type GeographicPoint,
  type TransferModeSegment,
} from './landSeaTransfer';

function rectangle(
  west: number,
  south: number,
  east: number,
  north: number,
): LandPolygon {
  return [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
    ],
  ];
}

const HORIZONTAL_PATH = {
  from: { latitude: 0, longitude: -4 },
  to: { latitude: 0, longitude: 4 },
} as const;

function expectContiguous(segments: readonly TransferModeSegment[]): void {
  expect(segments[0].startT).toBe(0);
  expect(segments[segments.length - 1].endT).toBe(1);
  for (let index = 0; index < segments.length - 1; index += 1) {
    expect(segments[index].endT).toBe(segments[index + 1].startT);
    expect(segments[index].mode).not.toBe(segments[index + 1].mode);
  }
}

describe('land polygon classification', () => {
  it('recognizes representative land and sea points in the bundled map', () => {
    expect(isPointOnLand({ latitude: 37.5665, longitude: 126.978 })).toBe(true);
    expect(isPointOnLand({ latitude: 0, longitude: -140 })).toBe(false);
  });

  it('uses even-odd ring parity for polygon holes', () => {
    const donut: LandGeometry = [
      [
        rectangle(-5, -5, 5, 5)[0],
        rectangle(-1, -1, 1, 1)[0],
      ],
    ];

    expect(isPointOnLand({ latitude: 4, longitude: 0 }, donut)).toBe(true);
    expect(isPointOnLand({ latitude: 0, longitude: 0 }, donut)).toBe(false);
    expect(isPointOnLand({ latitude: 0, longitude: 1 }, donut)).toBe(true);
  });

  it('normalizes wrapped query longitudes', () => {
    const geometry: LandGeometry = [rectangle(4, -1, 6, 1)];
    for (const longitude of [5, 365, -355]) {
      expect(isPointOnLand({ latitude: 0, longitude }, geometry)).toBe(true);
    }
  });

  it('treats invalid coordinates as sea', () => {
    expect(isPointOnLand({ latitude: Number.NaN, longitude: 0 })).toBe(false);
    expect(isPointOnLand({ latitude: 0, longitude: Number.POSITIVE_INFINITY })).toBe(false);
  });
});

describe('straight wrapped transfer geometry', () => {
  it('interpolates across the nearest dateline copy', () => {
    const from = { latitude: 10, longitude: 179 };
    const to = { latitude: 20, longitude: -179 };
    expect(shortestLongitudeDelta(from.longitude, to.longitude)).toBe(2);
    expect(transferPointAt(from, to, 0.5)).toEqual({
      latitude: 15,
      longitude: 180,
    });
  });

  it('classifies an all-land transfer as one segment', () => {
    const segments = segmentTransferByLand(
      HORIZONTAL_PATH.from,
      HORIZONTAL_PATH.to,
      [rectangle(-5, -2, 5, 2)],
    );
    expect(segments).toEqual([{ mode: 'land', startT: 0, endT: 1 }]);
  });

  it('classifies an all-sea transfer as one segment', () => {
    const segments = segmentTransferByLand(
      HORIZONTAL_PATH.from,
      HORIZONTAL_PATH.to,
      [],
    );
    expect(segments).toEqual([{ mode: 'sea', startT: 0, endT: 1 }]);
  });

  it('finds and refines land to sea to land transitions', () => {
    const geometry: LandGeometry = [
      rectangle(-5, -2, -1, 2),
      rectangle(1, -2, 5, 2),
    ];
    const segments = segmentTransferByLand(
      HORIZONTAL_PATH.from,
      HORIZONTAL_PATH.to,
      geometry,
      { minimumSegmentFraction: 0 },
    );

    expect(segments.map((segment) => segment.mode)).toEqual(['land', 'sea', 'land']);
    expect(segments[0].endT).toBeCloseTo(0.375, 4);
    expect(segments[1].endT).toBeCloseTo(0.625, 4);
    expectContiguous(segments);
  });

  it('supports multiple coastline transitions on one path', () => {
    const geometry: LandGeometry = [
      rectangle(-5, -2, -2.5, 2),
      rectangle(-1.5, -2, -0.5, 2),
      rectangle(0.5, -2, 1.5, 2),
      rectangle(2.5, -2, 5, 2),
    ];
    const segments = segmentTransferByLand(
      HORIZONTAL_PATH.from,
      HORIZONTAL_PATH.to,
      geometry,
      { minimumSegmentFraction: 0 },
    );

    expect(segments.map((segment) => segment.mode)).toEqual([
      'land',
      'sea',
      'land',
      'sea',
      'land',
      'sea',
      'land',
    ]);
    expectContiguous(segments);
  });

  it('refines a crossing inside a deliberately coarse sample interval', () => {
    const boundaryLongitude = 0.123;
    const from: GeographicPoint = { latitude: 0, longitude: -1 };
    const to: GeographicPoint = { latitude: 0, longitude: 1 };
    const segments = segmentTransferByLand(
      from,
      to,
      [rectangle(-2, -1, boundaryLongitude, 1)],
      {
        minimumSamples: 2,
        maximumSamples: 2,
        refinementSteps: 16,
        minimumSegmentFraction: 0,
      },
    );
    const expectedCrossing = (boundaryLongitude + 1) / 2;
    expect(segments[0].endT).toBeCloseTo(expectedCrossing, 4);
  });

  it('merges a sub-threshold coastline artifact to prevent flicker', () => {
    const merged = mergeTinyTransferSegments([
      { mode: 'land', startT: 0, endT: 0.49 },
      { mode: 'sea', startT: 0.49, endT: 0.495 },
      { mode: 'land', startT: 0.495, endT: 1 },
    ]);
    expect(merged).toEqual([{ mode: 'land', startT: 0, endT: 1 }]);
  });

  it('keeps dateline segmentation continuous across normalized longitudes', () => {
    const geometry: LandGeometry = [
      rectangle(178.5, -1, 179.5, 1),
      rectangle(-179.5, -1, -178.5, 1),
    ];
    const segments = segmentTransferByLand(
      { latitude: 0, longitude: 179 },
      { latitude: 0, longitude: -179 },
      geometry,
      { minimumSegmentFraction: 0 },
    );
    expect(segments.map((segment) => segment.mode)).toEqual(['land', 'sea', 'land']);
    expectContiguous(segments);
  });

  it('selects the later mode at an exact coastline boundary', () => {
    const segments: TransferModeSegment[] = [
      { mode: 'land', startT: 0, endT: 0.4 },
      { mode: 'sea', startT: 0.4, endT: 1 },
    ];
    expect(transferModeAt(segments, 0.399)).toBe('land');
    expect(transferModeAt(segments, 0.4)).toBe('sea');
    expect(transferModeAt(segments, 1)).toBe('sea');
  });

  it('provides a synthetic dateline browser fixture with bus to boat to bus modes', () => {
    const segments = segmentTransferByLand(
      geographicPoint(knownAirport('ANC')),
      geographicPoint(knownAirport('GDX')),
    );
    expect(segments.map((segment) => segment.mode)).toEqual(['land', 'sea', 'land']);
    expect(segments[0].endT).toBeCloseTo(0.248, 2);
    expect(segments[1].endT).toBeCloseTo(0.765, 2);
    expectContiguous(segments);
  });

  it('provides deterministic all-land and all-sea browser fixtures', () => {
    const modesForAirports = (from: string, to: string) =>
      segmentTransferByLand(
        geographicPoint(knownAirport(from)),
        geographicPoint(knownAirport(to)),
      ).map((segment) => segment.mode);

    expect(modesForAirports('NRT', 'HND')).toEqual(['land']);
    expect(modesForAirports('HNL', 'OGG')).toEqual(['sea']);
  });
});
