import { describe, expect, it } from 'vitest';
import {
  MANUAL_FLIGHT_SCHEMA_VERSION,
  type ManualFlightRecord,
} from './manualFlight';
import { manualCoordinateOverrides } from './manualCoordinates';

function record(
  id: string,
  createdAt: string,
  updatedAt: string,
  latitude: number | null,
): ManualFlightRecord {
  const airport = {
    iata: 'ZZZ',
    name: 'Historical Airport',
    municipality: 'Archive City',
    countryCode: 'KR',
    countryName: '대한민국',
    latitude,
    longitude: latitude == null ? null : 127,
  };
  return {
    schemaVersion: MANUAL_FLIGHT_SCHEMA_VERSION,
    id,
    date: '2025-01-21',
    departure: airport,
    arrival: { ...airport, iata: 'YYY' },
    type: '국내선',
    airline: '',
    flightNumber: '',
    aircraft: '',
    createdAt,
    updatedAt,
  };
}

describe('manual coordinate overrides', () => {
  it('keeps the earliest saved usable snapshot regardless of later edits', () => {
    const result = manualCoordinateOverrides([
      record(
        'later',
        '2025-02-01T00:00:00.000Z',
        '2025-02-01T00:00:00.000Z',
        38,
      ),
      record(
        'earlier',
        '2025-01-21T00:00:00.000Z',
        '2099-01-21T00:00:00.000Z',
        37,
      ),
    ]);
    expect(result.ZZZ).toEqual([37, 127]);
  });

  it('does not let a coordinate-free later snapshot erase a saved coordinate', () => {
    const result = manualCoordinateOverrides([
      record(
        'known',
        '2025-01-21T00:00:00.000Z',
        '2025-01-21T00:00:00.000Z',
        37,
      ),
      record(
        'unknown',
        '2025-02-01T00:00:00.000Z',
        '2025-02-01T00:00:00.000Z',
        null,
      ),
    ]);
    expect(result.ZZZ).toEqual([37, 127]);
  });

  it('masks the public index when every saved snapshot is unresolved', () => {
    const result = manualCoordinateOverrides([
      record(
        'unknown',
        '2025-01-21T00:00:00.000Z',
        '2025-01-21T00:00:00.000Z',
        null,
      ),
    ]);
    expect(Object.prototype.hasOwnProperty.call(result, 'ZZZ')).toBe(true);
    expect(result.ZZZ).toBeUndefined();
  });
});
