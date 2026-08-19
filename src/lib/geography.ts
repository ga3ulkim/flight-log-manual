import { AP, type AirportCoordinate } from '../data/airports';
import type { IataCode } from '../types';

export type MapPoint = readonly [x: number, y: number];

export interface ArcGeometry {
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  x2: number;
  y2: number;
  d: string;
}

const arcCache = new Map<string, ArcGeometry>();
let runtimeAirportCoordinates: Readonly<Record<IataCode, AirportCoordinate | undefined>> =
  Object.freeze(Object.create(null) as Record<IataCode, AirportCoordinate | undefined>);
let runtimeAirportCodes = new Set<IataCode>();

/**
 * Read-only compatibility lookup used throughout the validated map/playback
 * engine. Saved airport snapshots can temporarily override the public index
 * without mutating the generated data or changing existing consumers.
 */
export const AIRPORTS: Readonly<Record<IataCode, AirportCoordinate | undefined>> =
  new Proxy(Object.create(null) as Record<IataCode, AirportCoordinate | undefined>, {
    get(_target, property) {
      if (typeof property === 'string') {
        return runtimeAirportCodes.has(property)
          ? runtimeAirportCoordinates[property]
          : AP[property];
      }
      return undefined;
    },
  });
export const MAP_WIDTH = 1000;
export const MAP_LATITUDE_TOP = 76;
export const MAP_LATITUDE_BOTTOM = -58;
export const MAP_PIXELS_PER_DEGREE = MAP_WIDTH / 360;
export const MAP_HEIGHT = Math.round(
  (MAP_LATITUDE_TOP - MAP_LATITUDE_BOTTOM) * MAP_PIXELS_PER_DEGREE,
);
export const CAMERA_SCALE_MIN = 1;
export const CAMERA_SCALE_MAX = 30;

/** Replace archive-scoped coordinates and invalidate geometry derived from them. */
export function setRuntimeAirportCoordinates(
  coordinates: Readonly<Record<IataCode, AirportCoordinate | undefined>>,
): void {
  const next = Object.create(null) as Record<IataCode, AirportCoordinate>;
  const nextCodes = new Set<IataCode>();
  for (const [code, coordinate] of Object.entries(coordinates)) {
    const normalizedCode = code.trim().toUpperCase();
    nextCodes.add(normalizedCode);
    if (coordinate) {
      next[normalizedCode] = Object.freeze([coordinate[0], coordinate[1]]);
    }
  }
  runtimeAirportCoordinates = Object.freeze(next);
  runtimeAirportCodes = nextCodes;
  arcCache.clear();
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function projectLongitude(longitude: number): number {
  return (longitude + 180) * MAP_PIXELS_PER_DEGREE;
}

export function projectLatitude(latitude: number): number {
  return (MAP_LATITUDE_TOP - latitude) * MAP_PIXELS_PER_DEGREE;
}

export function normalizeWorldX(value: number): number {
  return ((value % MAP_WIDTH) + MAP_WIDTH) % MAP_WIDTH;
}

export function hasKnownAirport(code: IataCode): boolean {
  return AIRPORTS[code] != null;
}

export function knownAirport(code: IataCode): AirportCoordinate {
  const coordinate = AIRPORTS[code];
  if (!coordinate) {
    throw new Error(`Missing coordinates for airport ${code}`);
  }
  return coordinate;
}

export function haversine(a: AirportCoordinate, b: AirportCoordinate): number {
  const earthRadiusKm = 6371;
  const radiansPerDegree = Math.PI / 180;
  const latitudeDelta = (b[0] - a[0]) * radiansPerDegree;
  const longitudeDelta = (b[1] - a[1]) * radiansPerDegree;
  const chord =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(a[0] * radiansPerDegree) *
      Math.cos(b[0] * radiansPerDegree) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(chord));
}

/** Build the same shortest-longitude quadratic route used by the SVG map. */
export function arcGeometry(from: IataCode, to: IataCode): ArcGeometry {
  const key = `${from}>${to}`;
  const cached = arcCache.get(key);
  if (cached) return cached;

  const [fromLatitude, fromLongitude] = knownAirport(from);
  const [toLatitude, originalToLongitude] = knownAirport(to);
  let toLongitude = originalToLongitude;
  if (toLongitude - fromLongitude > 180) toLongitude -= 360;
  if (toLongitude - fromLongitude < -180) toLongitude += 360;

  const x1 = projectLongitude(fromLongitude);
  const y1 = projectLatitude(fromLatitude);
  const x2 = projectLongitude(toLongitude);
  const y2 = projectLatitude(toLatitude);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  let normalX = -dy / length;
  let normalY = dx / length;
  const midpointLatitude = (fromLatitude + toLatitude) / 2;
  const polewardDirection = midpointLatitude >= 0 ? -1 : 1;
  if (
    (normalY > 0 && polewardDirection < 0) ||
    (normalY < 0 && polewardDirection > 0)
  ) {
    normalX = -normalX;
    normalY = -normalY;
  }
  const offset = Math.min(70, Math.max(6, length * 0.2));
  const cx = (x1 + x2) / 2 + normalX * offset;
  const cy = (y1 + y2) / 2 + normalY * offset;
  const geometry = {
    x1,
    y1,
    cx,
    cy,
    x2,
    y2,
    d: `M${x1.toFixed(1)},${y1.toFixed(1)}Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`,
  };

  arcCache.set(key, geometry);
  return geometry;
}

export function quadraticPoint(geometry: ArcGeometry, progress: number): MapPoint {
  const remaining = 1 - progress;
  return [
    remaining * remaining * geometry.x1 +
      2 * remaining * progress * geometry.cx +
      progress * progress * geometry.x2,
    remaining * remaining * geometry.y1 +
      2 * remaining * progress * geometry.cy +
      progress * progress * geometry.y2,
  ];
}

export function quadraticAngle(geometry: ArcGeometry, progress: number): number {
  const dx =
    2 * (1 - progress) * (geometry.cx - geometry.x1) +
    2 * progress * (geometry.x2 - geometry.cx);
  const dy =
    2 * (1 - progress) * (geometry.cy - geometry.y1) +
    2 * progress * (geometry.y2 - geometry.cy);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** Return the target world copy closest to a reference x-coordinate. */
export function wrapTowards(
  referenceX: number,
  targetLatitude: number,
  targetLongitude: number,
): MapPoint {
  const rawX = projectLongitude(targetLongitude);
  const rawY = projectLatitude(targetLatitude);
  let deltaX = rawX - referenceX;
  if (deltaX > MAP_WIDTH / 2) deltaX -= MAP_WIDTH;
  if (deltaX < -MAP_WIDTH / 2) deltaX += MAP_WIDTH;
  return [referenceX + deltaX, rawY];
}

/** Choose once per segment; callers retain the result to prevent wrap jitter. */
export function nearestWorldOffset(rawX: number, referenceX: number): number {
  let bestOffset = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const offset of [-MAP_WIDTH, 0, MAP_WIDTH]) {
    const distance = Math.abs(rawX + offset - referenceX);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestOffset = offset;
    }
  }
  return bestOffset;
}

/** Use the validated flight-route scale model for any complete map-space leg. */
export function mapSpanCameraScale(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const shortRouteSoftener = 56;
  return (
    clamp(
      (0.62 * MAP_WIDTH) /
        Math.sqrt(length * length + shortRouteSoftener * shortRouteSoftener),
      1.6,
      11,
    ) * 1.3
  );
}

export function routeCameraScale(geometry: ArcGeometry): number {
  return mapSpanCameraScale(geometry.x1, geometry.y1, geometry.x2, geometry.y2);
}
