import { LAND, type LandGeometry, type LandRing } from '../data/landGeometry';
import type { AirportCoordinate } from '../data/airports';
import { clamp, haversine } from './geography';

export type TransferMode = 'land' | 'sea';

export interface GeographicPoint {
  latitude: number;
  longitude: number;
}

export interface TransferModeSegment {
  mode: TransferMode;
  startT: number;
  endT: number;
}

export interface TransferSegmentationOptions {
  degreesPerSample?: number;
  kilometersPerSample?: number;
  minimumSamples?: number;
  maximumSamples?: number;
  refinementSteps?: number;
  minimumSegmentFraction?: number;
}

/**
 * Fragments shorter than 1.25% of a transfer are merged into their neighbours.
 * At the shared 1.3–4.8 second animation duration this suppresses roughly
 * 16–60 ms coastline noise, which is too brief to communicate a useful mode.
 */
export const MIN_TRANSFER_MODE_FRACTION = 0.0125;

const DEFAULT_DEGREES_PER_SAMPLE = 0.25;
const DEFAULT_KILOMETERS_PER_SAMPLE = 20;
const DEFAULT_MINIMUM_SAMPLES = 16;
const DEFAULT_MAXIMUM_SAMPLES = 1024;
const DEFAULT_REFINEMENT_STEPS = 12;
const GEOMETRY_EPSILON = 1e-9;

interface RingContainment {
  inside: boolean;
  boundary: boolean;
}

export function geographicPoint(coordinate: AirportCoordinate): GeographicPoint {
  return { latitude: coordinate[0], longitude: coordinate[1] };
}

export function normalizeLongitude(longitude: number): number {
  return (((longitude + 180) % 360) + 360) % 360 - 180;
}

/** Match wrapTowards' strict 180-degree tie handling. */
export function shortestLongitudeDelta(from: number, to: number): number {
  let delta = (to - from) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

export function transferPointAt(
  from: GeographicPoint,
  to: GeographicPoint,
  progress: number,
): GeographicPoint {
  const t = clamp(progress, 0, 1);
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * t,
    longitude: from.longitude + shortestLongitudeDelta(from.longitude, to.longitude) * t,
  };
}

function pointOnRingEdge(point: GeographicPoint, ring: LandRing): boolean {
  const px = point.longitude;
  const py = point.latitude;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [x1, y1] = ring[previous];
    const [x2, y2] = ring[index];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const cross = (px - x1) * dy - (py - y1) * dx;
    const tolerance = GEOMETRY_EPSILON * Math.max(1, Math.abs(dx), Math.abs(dy));
    if (Math.abs(cross) > tolerance) continue;

    if (
      px >= Math.min(x1, x2) - GEOMETRY_EPSILON &&
      px <= Math.max(x1, x2) + GEOMETRY_EPSILON &&
      py >= Math.min(y1, y2) - GEOMETRY_EPSILON &&
      py <= Math.max(y1, y2) + GEOMETRY_EPSILON
    ) {
      return true;
    }
  }

  return false;
}

function ringContainment(point: GeographicPoint, ring: LandRing): RingContainment {
  if (ring.length < 3) return { inside: false, boundary: false };
  if (pointOnRingEdge(point, ring)) return { inside: true, boundary: true };

  let inside = false;
  const px = point.longitude;
  const py = point.latitude;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [x1, y1] = ring[previous];
    const [x2, y2] = ring[index];
    const crossesLatitude = (y1 > py) !== (y2 > py);
    if (!crossesLatitude) continue;
    const crossingX = ((x2 - x1) * (py - y1)) / (y2 - y1) + x1;
    if (px < crossingX) inside = !inside;
  }

  return { inside, boundary: false };
}

/**
 * Mirror the SVG's fillRule="evenodd": ring parity is evaluated inside each
 * top-level polygon, then the top-level polygons are combined as a union.
 * Exact coastline points count as land for deterministic airport behaviour.
 */
export function isPointOnLand(
  point: GeographicPoint,
  geometry: LandGeometry = LAND,
): boolean {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return false;
  const normalizedPoint = {
    latitude: point.latitude,
    longitude: normalizeLongitude(point.longitude),
  };

  return geometry.some((polygon) => {
    let inside = false;
    for (const ring of polygon) {
      const containment = ringContainment(normalizedPoint, ring);
      if (containment.boundary) return true;
      if (containment.inside) inside = !inside;
    }
    return inside;
  });
}

function transferDistanceKm(from: GeographicPoint, to: GeographicPoint): number {
  return haversine(
    [from.latitude, from.longitude],
    [to.latitude, to.longitude],
  );
}

function adaptiveSampleCount(
  from: GeographicPoint,
  to: GeographicPoint,
  options: TransferSegmentationOptions,
): number {
  const latitudeSpan = Math.abs(to.latitude - from.latitude);
  const longitudeSpan = Math.abs(shortestLongitudeDelta(from.longitude, to.longitude));
  const angularSpan = Math.hypot(latitudeSpan, longitudeSpan);
  const byAngle = angularSpan / (options.degreesPerSample ?? DEFAULT_DEGREES_PER_SAMPLE);
  const byDistance =
    transferDistanceKm(from, to) /
    (options.kilometersPerSample ?? DEFAULT_KILOMETERS_PER_SAMPLE);
  const minimum = Math.max(1, Math.floor(options.minimumSamples ?? DEFAULT_MINIMUM_SAMPLES));
  const maximum = Math.max(minimum, Math.floor(options.maximumSamples ?? DEFAULT_MAXIMUM_SAMPLES));
  return Math.round(clamp(Math.ceil(Math.max(byAngle, byDistance)), minimum, maximum));
}

function refineCoastCrossing(
  from: GeographicPoint,
  to: GeographicPoint,
  geometry: LandGeometry,
  leftT: number,
  rightT: number,
  leftMode: TransferMode,
  refinementSteps: number,
): number {
  let low = leftT;
  let high = rightT;
  for (let step = 0; step < refinementSteps; step += 1) {
    const middle = (low + high) / 2;
    const middleMode = isPointOnLand(transferPointAt(from, to, middle), geometry)
      ? 'land'
      : 'sea';
    if (middleMode === leftMode) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function coalesceTransferSegments(
  segments: readonly TransferModeSegment[],
): TransferModeSegment[] {
  const result: TransferModeSegment[] = [];
  for (const segment of segments) {
    if (segment.endT - segment.startT <= GEOMETRY_EPSILON) continue;
    const previous = result[result.length - 1];
    if (previous?.mode === segment.mode) {
      previous.endT = segment.endT;
    } else {
      result.push({ ...segment });
    }
  }
  return result;
}

/** Exported separately so the coastline-noise policy is deterministic and testable. */
export function mergeTinyTransferSegments(
  segments: readonly TransferModeSegment[],
  minimumFraction = MIN_TRANSFER_MODE_FRACTION,
): TransferModeSegment[] {
  let merged = coalesceTransferSegments(segments);
  const threshold = clamp(minimumFraction, 0, 1);
  if (threshold === 0) return merged;

  while (merged.length > 1) {
    const index = merged.findIndex(
      (segment) => segment.endT - segment.startT < threshold - GEOMETRY_EPSILON,
    );
    if (index < 0) break;

    if (index === 0) {
      merged[1] = { ...merged[1], startT: merged[0].startT };
      merged.splice(0, 1);
    } else if (index === merged.length - 1) {
      merged[index - 1] = { ...merged[index - 1], endT: merged[index].endT };
      merged.splice(index, 1);
    } else {
      const left = merged[index - 1];
      const right = merged[index + 1];
      if (left.mode === right.mode) {
        merged.splice(index - 1, 3, {
          mode: left.mode,
          startT: left.startT,
          endT: right.endT,
        });
      } else {
        const leftLength = left.endT - left.startT;
        const rightLength = right.endT - right.startT;
        if (leftLength >= rightLength) {
          merged[index - 1] = { ...left, endT: merged[index].endT };
          merged.splice(index, 1);
        } else {
          merged[index + 1] = { ...right, startT: merged[index].startT };
          merged.splice(index, 1);
        }
      }
    }
    merged = coalesceTransferSegments(merged);
  }

  if (merged.length > 0) {
    merged[0].startT = 0;
    merged[merged.length - 1].endT = 1;
  }
  return merged;
}

/**
 * Classify the existing straight, shortest-longitude transfer path. Samples
 * adapt to both angular span and distance; detected transitions are refined by
 * bisection before very short visual artifacts are merged.
 */
export function segmentTransferByLand(
  from: GeographicPoint,
  to: GeographicPoint,
  geometry: LandGeometry = LAND,
  options: TransferSegmentationOptions = {},
): TransferModeSegment[] {
  const startMode: TransferMode = isPointOnLand(from, geometry) ? 'land' : 'sea';
  const sampleCount = adaptiveSampleCount(from, to, options);
  const refinementSteps = Math.max(
    0,
    Math.floor(options.refinementSteps ?? DEFAULT_REFINEMENT_STEPS),
  );
  const rawSegments: TransferModeSegment[] = [];
  let segmentStart = 0;
  let currentMode = startMode;
  let previousT = 0;

  for (let index = 1; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    const mode: TransferMode = isPointOnLand(transferPointAt(from, to, t), geometry)
      ? 'land'
      : 'sea';
    if (mode !== currentMode) {
      const crossing = refineCoastCrossing(
        from,
        to,
        geometry,
        previousT,
        t,
        currentMode,
        refinementSteps,
      );
      rawSegments.push({ mode: currentMode, startT: segmentStart, endT: crossing });
      segmentStart = crossing;
      currentMode = mode;
    }
    previousT = t;
  }

  rawSegments.push({ mode: currentMode, startT: segmentStart, endT: 1 });
  return mergeTinyTransferSegments(
    rawSegments,
    options.minimumSegmentFraction ?? MIN_TRANSFER_MODE_FRACTION,
  );
}

export function transferModeAt(
  segments: readonly TransferModeSegment[],
  progress: number,
): TransferMode {
  if (segments.length === 0) return 'land';
  const t = clamp(progress, 0, 1);
  if (t >= 1) return segments[segments.length - 1].mode;
  return segments.find((segment) => t < segment.endT)?.mode ?? segments[segments.length - 1].mode;
}
