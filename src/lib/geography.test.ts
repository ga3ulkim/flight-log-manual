import { describe, expect, it } from 'vitest';
import {
  MAP_WIDTH,
  arcGeometry,
  hasKnownAirport,
  haversine,
  mapSpanCameraScale,
  nearestWorldOffset,
  normalizeWorldX,
  knownAirport,
  projectLatitude,
  projectLongitude,
  quadraticPoint,
  routeCameraScale,
  setRuntimeAirportCoordinates,
  wrapTowards,
} from './geography';

describe('geographic helpers', () => {
  it('computes a one-degree equatorial haversine distance', () => {
    expect(haversine([0, 0], [0, 1])).toBeCloseTo(111.195, 3);
  });

  it('normalizes user-controlled x positions into one world', () => {
    expect(normalizeWorldX(MAP_WIDTH + 25)).toBe(25);
    expect(normalizeWorldX(-25)).toBe(MAP_WIDTH - 25);
  });

  it('wraps a dateline target toward the closest world copy', () => {
    const reference = projectLongitude(179);
    const [target] = wrapTowards(reference, 0, -179);
    expect(Math.abs(target - reference)).toBeLessThan(10);
    expect(target).toBeGreaterThan(MAP_WIDTH);
  });

  it('selects a stable nearest world offset for a segment', () => {
    expect(nearestWorldOffset(5, 995)).toBe(MAP_WIDTH);
    expect(nearestWorldOffset(995, 5)).toBe(-MAP_WIDTH);
    expect(nearestWorldOffset(500, 510)).toBe(0);
  });

  it('uses the short longitudinal span for a dateline route', () => {
    const geometry = arcGeometry('HNL', 'NRT');
    expect(Math.abs(geometry.x2 - geometry.x1)).toBeLessThan(MAP_WIDTH / 2);
  });

  it('evaluates quadratic route endpoints exactly', () => {
    const geometry = arcGeometry('ICN', 'NRT');
    expect(quadraticPoint(geometry, 0)).toEqual([geometry.x1, geometry.y1]);
    expect(quadraticPoint(geometry, 1)).toEqual([geometry.x2, geometry.y2]);
  });

  it('zooms closer for a short route than a long route', () => {
    const shortScale = routeCameraScale(arcGeometry('ICN', 'CJU'));
    const longScale = routeCameraScale(arcGeometry('ICN', 'JFK'));
    expect(shortScale).toBeGreaterThan(longScale);
  });

  it('uses the exact flight-reference scale formula for a straight transfer span', () => {
    const geometry = arcGeometry('GDX', 'ANC');
    expect(
      mapSpanCameraScale(geometry.x1, geometry.y1, geometry.x2, geometry.y2),
    ).toBe(routeCameraScale(geometry));
  });

  it('zooms a short transfer closer than a long wrapped transfer', () => {
    const transferScale = (fromCode: string, toCode: string) => {
      const [fromLatitude, fromLongitude] = knownAirport(fromCode);
      const [toLatitude, toLongitude] = knownAirport(toCode);
      const fromX = projectLongitude(fromLongitude);
      const fromY = projectLatitude(fromLatitude);
      const [toX, toY] = wrapTowards(fromX, toLatitude, toLongitude);
      return mapSpanCameraScale(fromX, fromY, toX, toY);
    };

    const shortScale = transferScale('NRT', 'HND');
    const longDatelineScale = transferScale('ANC', 'GDX');
    expect(shortScale).toBeGreaterThan(longDatelineScale);
    expect(longDatelineScale).toBeLessThan(18);
  });

  it('uses archive-scoped snapshot coordinates and clears cached route geometry', () => {
    const original = knownAirport('ICN');
    const originalGeometry = arcGeometry('ICN', 'NRT');
    try {
      setRuntimeAirportCoordinates({ ICN: [0, 0] });
      expect(knownAirport('ICN')).toEqual([0, 0]);
      expect(arcGeometry('ICN', 'NRT').x1).not.toBe(originalGeometry.x1);
    } finally {
      setRuntimeAirportCoordinates({});
    }
    expect(knownAirport('ICN')).toEqual(original);
  });

  it('keeps a saved unknown-coordinate snapshot unresolved even if the public index has it', () => {
    try {
      setRuntimeAirportCoordinates({ ICN: undefined });
      expect(hasKnownAirport('ICN')).toBe(false);
      expect(() => knownAirport('ICN')).toThrow(/Missing coordinates/);
    } finally {
      setRuntimeAirportCoordinates({});
    }
  });
});
