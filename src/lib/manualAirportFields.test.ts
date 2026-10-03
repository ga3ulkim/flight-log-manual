import { describe, expect, it } from 'vitest';
import { manualFieldsFromSnapshot, manualSnapshot, updateManualAirportField } from './manualAirportFields';

const airport = {
  iata: 'ICN', name: 'Incheon', municipality: 'Seoul', countryCode: 'KR',
  countryName: '대한민국', latitude: 37.46, longitude: 126.44, timezoneId: 'Asia/Seoul',
};

describe('manual airport editing', () => {
  it('retains the zone through manual mode and display-label edits', () => {
    const fields = manualFieldsFromSnapshot(airport);
    expect(manualSnapshot(fields)).toEqual(airport);
    for (const key of ['name', 'municipality', 'countryName', 'countryCode'] as const) {
      expect(manualSnapshot(updateManualAirportField(fields, key, 'edited')).timezoneId).toBe('Asia/Seoul');
    }
  });

  it.each(['iata', 'latitude', 'longitude'] as const)('invalidates the zone when %s changes', (key) => {
    const fields = manualFieldsFromSnapshot(airport);
    const value = key === 'iata' ? 'JFK' : '1';
    expect(manualSnapshot(updateManualAirportField(fields, key, value)).timezoneId).toBeUndefined();
  });

  it('preserves the zone for equivalent coordinates and IATA formatting', () => {
    const fields = manualFieldsFromSnapshot(airport);
    expect(updateManualAirportField(fields, 'iata', ' icn ').timezoneId).toBe('Asia/Seoul');
    expect(updateManualAirportField(fields, 'latitude', '37.4600').timezoneId).toBe('Asia/Seoul');
    expect(manualSnapshot(manualFieldsFromSnapshot({ ...airport, latitude: null, longitude: null }))).toMatchObject({
      latitude: null, longitude: null, timezoneId: 'Asia/Seoul',
    });
  });
});
