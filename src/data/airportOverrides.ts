import type { AirportCoordinatesByCode } from './airports';

/**
 * Small, reviewed corrections layered over generated OurAirports coordinates.
 *
 * REP is retained for historical itineraries. The former Siem Reap
 * International Airport no longer appears with an IATA code in the current
 * upstream snapshot after scheduled service moved to SAI, but past flights can
 * still legitimately reference REP.
 */
export const MANUAL_AIRPORT_OVERRIDES = {
  REP: [13.41, 103.81],
} as const satisfies AirportCoordinatesByCode;

export const MANUAL_AIRPORT_OVERRIDE_COUNT = Object.keys(
  MANUAL_AIRPORT_OVERRIDES,
).length;
