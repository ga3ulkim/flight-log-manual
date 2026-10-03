import type { ManualAirportSnapshot } from './manualFlight';

export interface ManualAirportFields {
  iata: string;
  name: string;
  municipality: string;
  countryCode: string;
  countryName: string;
  latitude: string;
  longitude: string;
  timezoneId?: string;
}

export function manualFieldsFromSnapshot(snapshot: ManualAirportSnapshot): ManualAirportFields {
  return {
    iata: snapshot.iata,
    name: snapshot.name,
    municipality: snapshot.municipality,
    countryCode: snapshot.countryCode,
    countryName: snapshot.countryName,
    latitude: snapshot.latitude == null ? '' : String(snapshot.latitude),
    longitude: snapshot.longitude == null ? '' : String(snapshot.longitude),
    ...(snapshot.timezoneId ? { timezoneId: snapshot.timezoneId } : {}),
  };
}

function coordinateValue(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}

export function updateManualAirportField(
  fields: ManualAirportFields,
  key: Exclude<keyof ManualAirportFields, 'timezoneId'>,
  value: string,
): ManualAirportFields {
  const next = { ...fields, [key]: value };
  const locationChanged = key === 'iata'
    ? fields.iata.trim().toUpperCase() !== value.trim().toUpperCase()
    : (key === 'latitude' || key === 'longitude')
      && !Object.is(coordinateValue(fields[key]), coordinateValue(value));
  // A zone belongs to the selected location, not its editable display labels.
  if (locationChanged) delete next.timezoneId;
  return next;
}

export function manualSnapshot(fields: ManualAirportFields): ManualAirportSnapshot {
  return {
    iata: fields.iata.trim().toUpperCase(),
    name: fields.name.trim(),
    municipality: fields.municipality.trim(),
    countryCode: fields.countryCode.trim().toUpperCase(),
    countryName: fields.countryName.trim(),
    latitude: coordinateValue(fields.latitude),
    longitude: coordinateValue(fields.longitude),
    ...(fields.timezoneId ? { timezoneId: fields.timezoneId } : {}),
  };
}
