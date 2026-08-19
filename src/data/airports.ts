import { MANUAL_AIRPORT_OVERRIDES } from './airportOverrides';
import { GENERATED_AIRPORT_COORDINATES } from './generated/ourAirports';

/** Tuple order is [latitude, longitude]. */
export type AirportCoordinate = readonly [
  latitude: number,
  longitude: number,
];

export type AirportCoordinatesByCode = Readonly<
  Record<string, AirportCoordinate>
>;

export type AirportCoordinateLookup = Readonly<
  Record<string, AirportCoordinate | undefined>
>;

/** Resolve one code without allocating a merged index; overrides always win. */
export function resolveAirportCoordinate(
  code: string,
  generated: AirportCoordinateLookup = GENERATED_AIRPORT_COORDINATES,
  overrides: AirportCoordinateLookup = MANUAL_AIRPORT_OVERRIDES,
): AirportCoordinate | undefined {
  return overrides[code] ?? generated[code];
}

/** Build the compatibility lookup consumed by the validated map/playback code. */
export function mergeAirportCoordinates(
  generated: AirportCoordinatesByCode,
  overrides: AirportCoordinatesByCode,
): AirportCoordinatesByCode {
  return Object.freeze(
    Object.assign(Object.create(null) as Record<string, AirportCoordinate>, generated, overrides),
  );
}

/**
 * Local-only coordinate index. Normal application use performs no airport API
 * requests: manual corrections take precedence over the generated snapshot.
 */
export const AP = mergeAirportCoordinates(
  GENERATED_AIRPORT_COORDINATES,
  MANUAL_AIRPORT_OVERRIDES,
);

export type AirportCode = keyof typeof AP;
