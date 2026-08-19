import type { Flight, PlaybackProgress, RouteKey } from '../types';
import { routeKey } from './analytics';
import { clamp, hasKnownAirport, haversine, knownAirport } from './geography';

export interface PlaybackAdvance {
  progress: PlaybackProgress;
  done: boolean;
  missingFlight: boolean;
}

export function chronologicalFlights(flights: readonly Flight[]): Flight[] {
  return flights
    .filter(
      (flight) =>
        hasKnownAirport(flight.fa) &&
        hasKnownAirport(flight.ta) &&
        flight.fa !== flight.ta,
    )
    .slice()
    .sort((a, b) =>
      a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id - b.id,
    );
}

export function areSequentialFlightsConnected(current: Flight, next: Flight): boolean {
  return current.ta === next.fa;
}

/** Shared symbolic pacing for flights and disconnected airport transfers. */
export function journeyDuration(distanceKm: number): number {
  return clamp(1000 + Math.max(0, distanceKm) / 3, 1300, 4800);
}

export function flightDuration(flight: Flight): number {
  const distance = haversine(knownAirport(flight.fa), knownAirport(flight.ta));
  return journeyDuration(distance);
}

export function groundTransferDuration(distanceKm: number): number {
  return journeyDuration(distanceKm);
}

/** Advance at most one transition, matching the original per-frame state machine. */
export function advancePlayback(
  current: PlaybackProgress,
  elapsedMs: number,
  sequence: readonly Flight[],
): PlaybackAdvance {
  let idx = current.idx < 0 ? 0 : current.idx;
  let t = current.idx < 0 ? 0 : current.t;
  let hold = current.idx < 0 ? 0 : current.hold || 0;
  let holdTotal = current.idx < 0 ? 0 : current.holdTotal || 0;
  let done = false;

  if (hold > 0) {
    hold -= elapsedMs;
    if (hold <= 0) {
      idx += 1;
      t = 0;
      hold = 0;
      holdTotal = 0;
    }
  } else {
    const flight = sequence[idx];
    if (!flight) {
      return {
        progress: { idx: -1, t: 0, hold: 0, holdTotal: 0 },
        done: false,
        missingFlight: true,
      };
    }

    t += elapsedMs / flightDuration(flight);
    if (t >= 1) {
      const next = sequence[idx + 1];
      if (!next) {
        idx = sequence.length - 1;
        t = 1;
        hold = 0;
        holdTotal = 0;
        done = true;
      } else if (areSequentialFlightsConnected(flight, next)) {
        idx += 1;
        t = 0;
      } else {
        t = 1;
        const transferDistance =
          hasKnownAirport(flight.ta) && hasKnownAirport(next.fa)
            ? haversine(knownAirport(flight.ta), knownAirport(next.fa))
            : 0;
        const duration = groundTransferDuration(transferDistance);
        hold = duration;
        holdTotal = duration;
      }
    }
  }

  return {
    progress: { idx, t, hold, holdTotal },
    done,
    missingFlight: false,
  };
}

export function playedRouteKeys(
  sequence: readonly Flight[],
  currentIndex: number,
): Set<RouteKey> {
  const keys = new Set<RouteKey>();
  for (let index = 0; index <= Math.min(currentIndex, sequence.length - 1); index += 1) {
    const flight = sequence[index];
    keys.add(routeKey(flight.fa, flight.ta));
  }
  return keys;
}
