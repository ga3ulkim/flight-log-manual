import type { AirportCoordinate, AirportCoordinateLookup } from '../data/airports';
import type { ManualAirportSnapshot, ManualFlightRecord } from './manualFlight';

function snapshotCoordinate(snapshot: ManualAirportSnapshot): AirportCoordinate | null {
  return snapshot.latitude == null || snapshot.longitude == null
    ? null
    : [snapshot.latitude, snapshot.longitude];
}

function hasOwnCoordinate(
  coordinates: Record<string, AirportCoordinate | undefined>,
  iata: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(coordinates, iata);
}

/**
 * Build the archive-scoped map index from session-record snapshots. When records
 * disagree about one code, the earliest saved usable snapshot wins
 * deterministically. Editing unrelated flight metadata therefore cannot move
 * every route that shares an IATA code. A code is explicitly unresolved only
 * when every current-session snapshot for it lacks coordinates.
 */
export function manualCoordinateOverrides(
  records: readonly ManualFlightRecord[],
): AirportCoordinateLookup {
  const coordinates = Object.create(null) as Record<string, AirportCoordinate | undefined>;
  const ordered = [...records].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const encountered = new Set<string>();

  for (const record of ordered) {
    for (const airport of [record.departure, record.arrival]) {
      encountered.add(airport.iata);
      const coordinate = snapshotCoordinate(airport);
      if (coordinate && !hasOwnCoordinate(coordinates, airport.iata)) {
        coordinates[airport.iata] = coordinate;
      }
    }
  }

  for (const iata of encountered) {
    if (!hasOwnCoordinate(coordinates, iata)) coordinates[iata] = undefined;
  }
  return Object.freeze(coordinates);
}
