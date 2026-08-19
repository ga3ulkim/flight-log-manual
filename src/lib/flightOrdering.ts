import type { Flight } from '../types';

export type FlightOrderDirection = 'ascending' | 'descending';

function dateKey(flight: Flight): string | null {
  if (flight.y == null) return null;
  const sortDate = /^(\d{4}\.\d{2}\.\d{2})/.exec(flight.sortKey)?.[1];
  return sortDate ?? `${flight.y}.00.00`;
}

/**
 * Timed records precede untimed records on the same day in both directions.
 * Two times sort naturally in the requested direction; equal/missing values
 * return zero so callers can apply their stable identity fallback.
 */
export function compareOptionalDepartureTimes(
  left: string | undefined,
  right: string | undefined,
  direction: FlightOrderDirection,
): number {
  if (left && !right) return -1;
  if (!left && right) return 1;
  if (!left || !right || left === right) return 0;
  const comparison = left < right ? -1 : 1;
  return direction === 'ascending' ? comparison : -comparison;
}

/** Date ascending, then timed HH:mm ascending, then stable source ID. */
export function compareFlightsChronologically(left: Flight, right: Flight): number {
  const leftDate = dateKey(left);
  const rightDate = dateKey(right);
  if (leftDate === null && rightDate !== null) return 1;
  if (leftDate !== null && rightDate === null) return -1;
  if (leftDate !== rightDate) return leftDate! < rightDate! ? -1 : 1;
  return compareOptionalDepartureTimes(
    left.departureTime,
    right.departureTime,
    'ascending',
  ) || left.id - right.id;
}

/** Date descending, then timed HH:mm descending, then reverse source ID. */
export function compareFlightsNewestFirst(left: Flight, right: Flight): number {
  const leftDate = dateKey(left);
  const rightDate = dateKey(right);
  if (leftDate === null && rightDate !== null) return 1;
  if (leftDate !== null && rightDate === null) return -1;
  if (leftDate !== rightDate) return leftDate! > rightDate! ? -1 : 1;
  return compareOptionalDepartureTimes(
    left.departureTime,
    right.departureTime,
    'descending',
  ) || right.id - left.id;
}
