import { Temporal } from 'temporal-polyfill';
import type { AirportCoordinate } from '../data/airports';
import type { Flight } from '../types';
import { AIRPORTS, haversine } from './geography';

/**
 * A deliberately small, deterministic block-time approximation. It models a
 * fixed taxi/climb/descent allowance plus great-circle travel at a generic jet
 * cruise-equivalent speed. It does not model schedules, winds, routing or ATC.
 */
export const ESTIMATED_FLIGHT_DURATION_MODEL = Object.freeze({
  fixedOverheadMinutes: 35,
  cruiseEquivalentKilometresPerHour: 850,
  minimumMinutes: 45,
  roundingMinutes: 5,
});

export type DepartureLocalDateTimeResolution =
  | {
      status: 'valid';
      epochNanoseconds: bigint;
      /** Repeated fall-back times deterministically choose the earlier instant. */
      ambiguous: boolean;
    }
  | {
      status: 'invalid';
      reason: 'invalid_input' | 'invalid_timezone' | 'nonexistent_local_time';
    };

export interface EstimatedLocalDateTime {
  /** Calendar date local to this airport, formatted YYYY.MM.DD. */
  date: string;
  /** Wall-clock time local to this airport, formatted HH:mm. */
  time: string;
  timeZoneId: string;
}

export type EstimatedFlightTiming =
  | {
      status: 'available';
      durationMinutes: number;
      departure: EstimatedLocalDateTime;
      arrival: EstimatedLocalDateTime;
    }
  | {
      status: 'unavailable';
      reason:
        | 'missing_departure_time'
        | 'missing_timezone'
        | 'missing_coordinates'
        | 'invalid_departure_time';
      /** Available even when a local arrival clock cannot be derived. */
      durationMinutes?: number;
    };

interface FlightWithOptionalSnapshots extends Flight {
  departureSnapshot?: {
    latitude?: number | null;
    longitude?: number | null;
  };
  arrivalSnapshot?: {
    latitude?: number | null;
    longitude?: number | null;
  };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function localDateTime(value: Temporal.ZonedDateTime): EstimatedLocalDateTime {
  return {
    date: `${String(value.year).padStart(4, '0')}.${twoDigits(value.month)}.${twoDigits(value.day)}`,
    time: `${twoDigits(value.hour)}:${twoDigits(value.minute)}`,
    timeZoneId: value.timeZoneId,
  };
}

function snapshotCoordinate(
  flight: FlightWithOptionalSnapshots,
  endpoint: 'departure' | 'arrival',
): AirportCoordinate | undefined {
  const snapshot = endpoint === 'departure'
    ? flight.departureSnapshot
    : flight.arrivalSnapshot;
  if (
    snapshot
    && typeof snapshot.latitude === 'number'
    && Number.isFinite(snapshot.latitude)
    && typeof snapshot.longitude === 'number'
    && Number.isFinite(snapshot.longitude)
  ) {
    return [snapshot.latitude, snapshot.longitude];
  }
  return AIRPORTS[endpoint === 'departure' ? flight.fa : flight.ta];
}

function canonicalDepartureDate(flight: Flight): string | undefined {
  const match = /^(\d{4})[.-](\d{2})[.-](\d{2})$/.exec(flight.d.trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

/** Reject fixed offsets; calculations require a named IANA timezone snapshot. */
export function isValidIanaTimeZoneId(value: string): boolean {
  const timeZoneId = value.trim();
  if (!timeZoneId || /^[+-]\d{2}(?::?\d{2})?$/.test(timeZoneId)) return false;
  try {
    Temporal.PlainDateTime.from('2000-01-01T00:00').toZonedDateTime(timeZoneId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a local wall clock with explicit DST behavior: forward-gap values
 * are invalid, while a repeated fall-back value chooses the earlier instant.
 */
export function resolveDepartureLocalDateTime(
  date: string,
  time: string,
  timeZoneId: string,
): DepartureLocalDateTimeResolution {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  ) {
    return { status: 'invalid', reason: 'invalid_input' };
  }
  if (!isValidIanaTimeZoneId(timeZoneId)) {
    return { status: 'invalid', reason: 'invalid_timezone' };
  }

  try {
    const plain = Temporal.PlainDateTime.from(`${date}T${time}`, {
      overflow: 'reject',
    });
    const earlier = plain.toZonedDateTime(timeZoneId, {
      disambiguation: 'earlier',
    });
    const later = plain.toZonedDateTime(timeZoneId, {
      disambiguation: 'later',
    });
    if (
      !earlier.toPlainDateTime().equals(plain)
      || !later.toPlainDateTime().equals(plain)
    ) {
      return { status: 'invalid', reason: 'nonexistent_local_time' };
    }
    return {
      status: 'valid',
      epochNanoseconds: earlier.epochNanoseconds,
      ambiguous: earlier.epochNanoseconds !== later.epochNanoseconds,
    };
  } catch {
    return { status: 'invalid', reason: 'invalid_input' };
  }
}

/** Estimate typical block time from great-circle distance, rounded to 5 min. */
export function estimateFlightDurationMinutes(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new RangeError('Flight distance must be a finite, non-negative number.');
  }
  const model = ESTIMATED_FLIGHT_DURATION_MODEL;
  const unrounded = model.fixedOverheadMinutes
    + (distanceKm / model.cruiseEquivalentKilometresPerHour) * 60;
  const rounded = Math.round(unrounded / model.roundingMinutes)
    * model.roundingMinutes;
  return Math.max(model.minimumMinutes, rounded);
}

/**
 * Derive approximate duration and timezone-aware local arrival information.
 * This does not alter symbolic playback duration or animation speed.
 */
export function estimateFlightTiming(flight: Flight): EstimatedFlightTiming {
  const timingFlight = flight as FlightWithOptionalSnapshots;
  const departureCoordinate = snapshotCoordinate(timingFlight, 'departure');
  const arrivalCoordinate = snapshotCoordinate(timingFlight, 'arrival');
  if (!departureCoordinate || !arrivalCoordinate) {
    return { status: 'unavailable', reason: 'missing_coordinates' };
  }

  const durationMinutes = estimateFlightDurationMinutes(
    haversine(departureCoordinate, arrivalCoordinate),
  );
  if (!flight.departureTime) {
    return {
      status: 'unavailable',
      reason: 'missing_departure_time',
      durationMinutes,
    };
  }
  if (!flight.departureTimeZoneId || !flight.arrivalTimeZoneId) {
    return {
      status: 'unavailable',
      reason: 'missing_timezone',
      durationMinutes,
    };
  }

  const date = canonicalDepartureDate(flight);
  if (!date) {
    return {
      status: 'unavailable',
      reason: 'invalid_departure_time',
      durationMinutes,
    };
  }
  const resolution = resolveDepartureLocalDateTime(
    date,
    flight.departureTime,
    flight.departureTimeZoneId,
  );
  if (resolution.status === 'invalid') {
    return {
      status: 'unavailable',
      reason: resolution.reason === 'invalid_timezone'
        ? 'missing_timezone'
        : 'invalid_departure_time',
      durationMinutes,
    };
  }

  try {
    const departure = Temporal.Instant
      .fromEpochNanoseconds(resolution.epochNanoseconds)
      .toZonedDateTimeISO(flight.departureTimeZoneId);
    const arrival = departure.toInstant()
      .add({ minutes: durationMinutes })
      .toZonedDateTimeISO(flight.arrivalTimeZoneId);
    return {
      status: 'available',
      durationMinutes,
      departure: localDateTime(departure),
      arrival: localDateTime(arrival),
    };
  } catch {
    return {
      status: 'unavailable',
      reason: 'missing_timezone',
      durationMinutes,
    };
  }
}

export function formatEstimatedDurationKo(minutes: number): string {
  const normalized = Math.max(0, Math.round(minutes));
  const hours = Math.floor(normalized / 60);
  const remainder = normalized % 60;
  if (hours === 0) return `${remainder}분`;
  if (remainder === 0) return `${hours}시간`;
  return `${hours}시간 ${remainder}분`;
}
