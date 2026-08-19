import { describe, expect, it } from 'vitest';
import {
  ManualFlightValidationError,
  createManualAirportSnapshot,
  createManualFlight,
  inferManualFlightType,
  isValidDateOnly,
  isValidDepartureTime,
  manualFlightToFlight,
  manualFlightsToFlights,
  updateManualFlight,
  validateManualFlightRecord,
} from './manualFlight';
import type { ManualAirportSnapshot, ManualFlightInput } from './manualFlight';

function airport(
  iata: string,
  countryCode: string,
  overrides: Partial<ManualAirportSnapshot> = {},
): ManualAirportSnapshot {
  return {
    iata,
    name: `${iata} Synthetic Airport`,
    municipality: `${iata} City`,
    countryCode,
    countryName: countryCode ? `Country ${countryCode}` : '',
    latitude: 37.1,
    longitude: 127.1,
    ...overrides,
  };
}

function input(overrides: Partial<ManualFlightInput> = {}): ManualFlightInput {
  return {
    date: '2025-01-21',
    departure: airport('ICN', 'KR'),
    arrival: airport('NRT', 'JP', { latitude: 35.8, longitude: 140.4 }),
    airline: 'Example Air',
    flightNumber: 'EX 101',
    aircraft: 'B787-9',
    ...overrides,
  };
}

function record(id = 'flight-1', overrides: Partial<ManualFlightInput> = {}) {
  return createManualFlight(input(overrides), {
    generateId: () => id,
    now: () => new Date('2025-02-01T01:02:03.000Z'),
  });
}

describe('manual flight domain', () => {
  it('infers domestic and international routes only from two known country codes', () => {
    expect(inferManualFlightType(airport('ICN', 'KR'), airport('PUS', 'KR'))).toBe('국내선');
    expect(inferManualFlightType(airport('ICN', 'KR'), airport('NRT', 'JP'))).toBe('국제선');
    expect(inferManualFlightType(airport('ICN', ''), airport('NRT', 'JP'))).toBeNull();
  });

  it('requires an explicit safe classification for an unknown-country airport', () => {
    const unknown = airport('ZZZ', '', {
      name: 'Historical Airport',
      countryName: '',
      latitude: null,
      longitude: null,
    });
    expect(() => createManualFlight(input({ departure: unknown }), {
      generateId: () => 'unknown-1',
    })).toThrow(ManualFlightValidationError);

    const saved = createManualFlight(input({ departure: unknown, type: '국제선' }), {
      generateId: () => 'unknown-2',
      now: () => new Date('2025-01-01T00:00:00Z'),
    });
    expect(saved.type).toBe('국제선');
    expect(saved.departure.latitude).toBeNull();
    expect(manualFlightToFlight(saved).type).toBe('국제선');
  });

  it('rejects an explicit classification that conflicts with known countries', () => {
    expect(() => createManualFlight(input({ type: '국내선' }), {
      generateId: () => 'conflict-1',
    })).toThrow(/일치하지 않습니다/);
  });

  it('creates a detached immutable airport snapshot from search metadata and coordinates', () => {
    const mutable = {
      iata: 'icn',
      name: ' Incheon International Airport ',
      municipality: ' Incheon ',
      countryCode: 'kr',
      countryName: ' 대한민국 ',
    };
    const snapshot = createManualAirportSnapshot(mutable, [37.4602, 126.4407]);
    mutable.name = 'Changed public catalog name';

    expect(snapshot).toEqual({
      iata: 'ICN',
      name: 'Incheon International Airport',
      municipality: 'Incheon',
      countryCode: 'KR',
      countryName: '대한민국',
      latitude: 37.4602,
      longitude: 126.4407,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.name).toBe('Incheon International Airport');
  });

  it('keeps airport history inside the saved record when a later source object changes', () => {
    const departure = airport('ICN', 'KR');
    const saved = record('history-1', { departure });
    departure.name = 'Renamed after save';
    departure.latitude = 0;

    expect(saved.departure.name).toBe('ICN Synthetic Airport');
    expect(saved.departure.latitude).toBe(37.1);
    expect(validateManualFlightRecord(saved).departure).toEqual(saved.departure);
  });

  it('validates a real date-only calendar value without timezone conversion', () => {
    expect(isValidDateOnly('2024-02-29')).toBe(true);
    expect(isValidDateOnly('2025-02-29')).toBe(false);
    expect(isValidDateOnly('2025-01-21T00:00:00Z')).toBe(false);

    const saved = record('date-1');
    expect(saved.date).toBe('2025-01-21');
    expect(manualFlightToFlight(saved)).toMatchObject({
      d: '2025.01.21',
      y: 2025,
      sortKey: '2025.01.21',
    });
  });

  it('accepts an optional minute-precision departure time and allows clearing it', () => {
    expect(isValidDepartureTime('14:30')).toBe(true);
    expect(isValidDepartureTime('24:00')).toBe(false);
    expect(isValidDepartureTime('12:60')).toBe(false);

    const dateOnly = record('date-only', { departureTime: '' });
    expect(dateOnly.departureTime).toBeUndefined();

    const timed = record('timed', { departureTime: '14:30' });
    expect(timed.departureTime).toBe('14:30');
    const preserved = updateManualFlight(timed, input({ departureTime: timed.departureTime }), {
      now: () => new Date('2025-02-02T00:00:00Z'),
    });
    expect(preserved.departureTime).toBe('14:30');
    const cleared = updateManualFlight(preserved, input({ departureTime: '' }), {
      now: () => new Date('2025-02-03T00:00:00Z'),
    });
    expect(cleared.departureTime).toBeUndefined();

    expect(() => record('bad-hour', { departureTime: '24:00' })).toThrow(/HH:mm/);
    expect(() => record('bad-minute', { departureTime: '12:60' })).toThrow(/HH:mm/);
  });

  it('snapshots IANA timezones and selected airline codes in the adapted flight', () => {
    const saved = record('snapshot-v2', {
      departureTime: '14:30',
      departure: airport('ICN', 'KR', { timezoneId: 'Asia/Seoul' }),
      arrival: airport('LAX', 'US', {
        latitude: 33.9425,
        longitude: -118.4081,
        timezoneId: 'America/Los_Angeles',
      }),
      airline: 'Korean Air',
      airlineSnapshot: {
        name: 'Korean Air',
        iata: 'ke',
        icao: 'kal',
        country: '  South Korea  ',
      },
    });
    expect(saved).toMatchObject({
      schemaVersion: 2,
      departureTime: '14:30',
      departure: { timezoneId: 'Asia/Seoul' },
      arrival: { timezoneId: 'America/Los_Angeles' },
      airlineSnapshot: {
        name: 'Korean Air',
        iata: 'KE',
        icao: 'KAL',
        country: 'South Korea',
      },
    });
    expect(manualFlightToFlight(saved)).toMatchObject({
      departureTime: '14:30',
      departureTimeZoneId: 'Asia/Seoul',
      arrivalTimeZoneId: 'America/Los_Angeles',
      airlineIata: 'KE',
      airlineIcao: 'KAL',
      sortKey: '2025.01.21 14:30',
    });
    expect(() => record('bad-airline-snapshot', {
      airline: 'Free Text Air',
      airlineSnapshot: { name: 'Different Air', iata: 'XX', icao: 'XXX' },
    })).toThrow(/airline|\uD56D\uACF5\uC0AC/i);
  });

  it('rejects a nonexistent DST-forward local time but accepts repeated time deterministically', () => {
    const newYork = airport('JFK', 'US', {
      latitude: 40.6399,
      longitude: -73.7787,
      timezoneId: 'America/New_York',
    });
    expect(() => record('dst-gap', {
      date: '2026-03-08',
      departureTime: '02:30',
      departure: newYork,
    })).toThrow(/\uC11C\uBA38\uD0C0\uC784/);
    expect(record('dst-overlap', {
      date: '2026-11-01',
      departureTime: '01:30',
      departure: newYork,
    }).departureTime).toBe('01:30');
  });

  it('migrates a V1 record without inventing time, timezone, or airline metadata', () => {
    const current = record('legacy-source', {
      departureTime: '14:30',
      departure: airport('ICN', 'KR', { timezoneId: 'Asia/Seoul' }),
      arrival: airport('NRT', 'JP', { timezoneId: 'Asia/Tokyo' }),
      airlineSnapshot: { name: 'Example Air', iata: 'EX', icao: 'EXP' },
    });
    const legacy = {
      ...current,
      schemaVersion: 1,
      departure: { ...current.departure, timezoneId: 'Asia/Seoul' },
      arrival: { ...current.arrival, timezoneId: 'Asia/Tokyo' },
    };
    const migrated = validateManualFlightRecord(legacy);

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.departureTime).toBeUndefined();
    expect(migrated.departure.timezoneId).toBeUndefined();
    expect(migrated.arrival.timezoneId).toBeUndefined();
    expect(migrated.airlineSnapshot).toBeUndefined();
  });

  it('trims optional fields and canonicalizes airport and country codes', () => {
    const saved = record('trim-1', {
      departure: airport('icn', 'kr', { name: '  Airport  ' }),
      airline: '  Example Air  ',
      flightNumber: '  EX 101  ',
      aircraft: '  A321neo  ',
    });
    expect(saved).toMatchObject({
      airline: 'Example Air',
      flightNumber: 'EX 101',
      aircraft: 'A321neo',
    });
    expect(saved.departure).toMatchObject({ iata: 'ICN', countryCode: 'KR', name: 'Airport' });
  });

  it('rejects required fields, equal endpoints, malformed IATA, and coordinate ranges', () => {
    expect(() => record('missing-date', { date: '' })).toThrow(ManualFlightValidationError);
    expect(() => record('same', { arrival: airport('ICN', 'KR') })).toThrow(/달라야 합니다/);
    expect(() => record('iata', { departure: airport('AB12', 'KR') })).toThrow(/영문 3자/);
    expect(() => record('latitude', {
      departure: airport('ICN', 'KR', { latitude: 91 }),
    })).toThrow(/-90에서 90/);
    expect(() => record('pair', {
      departure: airport('ICN', 'KR', { longitude: null }),
    })).toThrow(/함께 입력/);
  });

  it('preserves immutable identity/createdAt and changes updatedAt on edit', () => {
    const saved = record('stable-id');
    const updated = updateManualFlight(saved, input({ airline: 'Updated Air' }), {
      now: () => new Date('2025-03-02T04:05:06Z'),
    });
    expect(updated.id).toBe('stable-id');
    expect(updated.createdAt).toBe(saved.createdAt);
    expect(updated.updatedAt).toBe('2025-03-02T04:05:06.000Z');
    expect(updated.airline).toBe('Updated Air');
  });

  it('advances an edit by one millisecond when the device clock is behind imported metadata', () => {
    const future = createManualFlight(input(), {
      generateId: () => 'future-clock-id',
      now: () => new Date('2030-01-01T00:00:00Z'),
    });
    const updated = updateManualFlight(future, input({ airline: 'Clock Safe Air' }), {
      now: () => new Date('2026-08-19T00:00:00Z'),
    });

    expect(updated.updatedAt).toBe('2030-01-01T00:00:00.001Z');
    expect(Date.parse(updated.updatedAt)).toBe(Date.parse(future.updatedAt) + 1);
    expect(validateManualFlightRecord(updated)).toEqual(updated);
  });

  it('keeps stable manual IDs while assigning source-order numeric visualization IDs', () => {
    const records = [record('uuid-z'), record('uuid-a')];
    const adapted = manualFlightsToFlights(records);
    expect(adapted.map((flight) => flight.id)).toEqual([0, 1]);
    expect(adapted.map((flight) => flight.manualId)).toEqual(['uuid-z', 'uuid-a']);
    expect(adapted[0].departureSnapshot).toEqual(records[0].departure);
  });
});
