import type { Flight, FlightType } from '../types';
import {
  isValidIanaTimeZoneId,
  resolveDepartureLocalDateTime,
} from './flightTiming';

export const LEGACY_MANUAL_FLIGHT_SCHEMA_VERSION = 1 as const;
export const MANUAL_FLIGHT_SCHEMA_VERSION = 2 as const;

export type ManualFlightClassification = FlightType;
export type InferredManualFlightClassification = FlightType | null;

export interface ManualAirportSnapshot {
  iata: string;
  name: string;
  municipality: string;
  countryCode: string;
  countryName: string;
  latitude: number | null;
  longitude: number | null;
  /** IANA zone captured when the endpoint was selected; absent if unresolved. */
  timezoneId?: string;
}

export interface ManualAirportSnapshotSource {
  iata: string;
  name?: string;
  municipality?: string;
  countryCode?: string;
  countryName?: string;
  latitude?: number | null;
  longitude?: number | null;
  timezoneId?: string;
}

export interface ManualAirlineSnapshot {
  name: string;
  iata: string;
  icao: string;
  /** Display country captured to distinguish same-name catalog entities. */
  country?: string;
}

export interface ManualFlightInput {
  date: string;
  /** Local wall-clock time at departure, never a browser/UTC timestamp. */
  departureTime?: string;
  departure: ManualAirportSnapshot;
  arrival: ManualAirportSnapshot;
  airline?: string;
  airlineSnapshot?: ManualAirlineSnapshot;
  flightNumber?: string;
  aircraft?: string;
  /** Required only when one or both airport country codes are unavailable. */
  type?: FlightType;
}

export interface ManualFlightRecord {
  schemaVersion: typeof MANUAL_FLIGHT_SCHEMA_VERSION;
  id: string;
  date: string;
  departureTime?: string;
  departure: ManualAirportSnapshot;
  arrival: ManualAirportSnapshot;
  type: ManualFlightClassification;
  airline: string;
  airlineSnapshot?: ManualAirlineSnapshot;
  flightNumber: string;
  aircraft: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManualAdaptedFlight extends Flight {
  /** Stable manual-record identity. Use this for edit/delete operations. */
  manualId: string;
  classificationKnown: boolean;
  departureSnapshot: ManualAirportSnapshot;
  arrivalSnapshot: ManualAirportSnapshot;
}

export interface ManualFlightValidationIssue {
  path: string;
  code: string;
  message: string;
}

export class ManualFlightValidationError extends Error {
  readonly issues: readonly ManualFlightValidationIssue[];

  constructor(issues: readonly ManualFlightValidationIssue[]) {
    super(issues.map((issue) => issue.message).join(' '));
    this.name = 'ManualFlightValidationError';
    this.issues = issues;
  }
}

export interface ManualFlightFactories {
  generateId?: () => string;
  now?: () => Date;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isValidDepartureTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function optionalTime(value: unknown, issues: ManualFlightValidationIssue[]): string | undefined {
  const normalized = text(value);
  if (!normalized) return undefined;
  if (!isValidDepartureTime(normalized)) {
    issues.push({
      path: 'departureTime',
      code: 'time_only',
      message: '출발 시간은 HH:mm 형식의 올바른 시간이어야 합니다.',
    });
    return undefined;
  }
  return normalized;
}

function optionalTimeZoneId(
  value: unknown,
  path: string,
  issues: ManualFlightValidationIssue[],
): string | undefined {
  const normalized = text(value);
  if (!normalized) return undefined;
  if (!isValidIanaTimeZoneId(normalized)) {
    issues.push({
      path,
      code: 'timezone_id',
      message: `${path}은 올바른 IANA 시간대 ID여야 합니다.`,
    });
    return undefined;
  }
  return normalized;
}

function normalizeAirlineSnapshot(
  value: unknown,
  airline: string,
  issues: ManualFlightValidationIssue[],
): ManualAirlineSnapshot | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push({
      path: 'airlineSnapshot',
      code: 'airline_snapshot',
      message: '선택한 항공사 정보 형식이 올바르지 않습니다.',
    });
    return undefined;
  }

  const name = text(value.name);
  const iata = text(value.iata).toUpperCase();
  const icao = text(value.icao).toUpperCase();
  const country = text(value.country);
  if (!name || name !== airline) {
    issues.push({
      path: 'airlineSnapshot.name',
      code: 'airline_snapshot_name',
      message: '선택한 항공사의 이름은 항공사 입력값과 같아야 합니다.',
    });
  }
  if (iata && !/^[A-Z0-9]{2}$/.test(iata)) {
    issues.push({
      path: 'airlineSnapshot.iata',
      code: 'airline_iata',
      message: '항공사 IATA 코드는 영문자/숫자 2자여야 합니다.',
    });
  }
  if (icao && !/^[A-Z]{3}$/.test(icao)) {
    issues.push({
      path: 'airlineSnapshot.icao',
      code: 'airline_icao',
      message: '항공사 ICAO 코드는 영문 3자여야 합니다.',
    });
  }
  return { name, iata, icao, ...(country ? { country } : {}) };
}

function hasUnsafeIdCharacter(value: string): boolean {
  if (/\s/.test(value)) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function optionalCoordinate(
  value: unknown,
  path: string,
  min: number,
  max: number,
  issues: ManualFlightValidationIssue[],
): number | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    issues.push({
      path,
      code: 'coordinate_range',
      message: `${path} 값은 ${min}에서 ${max} 사이의 숫자여야 합니다.`,
    });
    return null;
  }
  return value;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Validate a calendar date without passing through a timezone-bearing Date. */
export function isValidDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year >= 1900 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function isIsoInstant(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function normalizeAirport(
  value: unknown,
  path: string,
  issues: ManualFlightValidationIssue[],
): ManualAirportSnapshot {
  const airport = isRecord(value) ? value : {};
  if (!isRecord(value)) {
    issues.push({ path, code: 'required', message: `${path} 공항 정보가 필요합니다.` });
  }

  const rawIata = text(airport.iata);
  const iata = rawIata.toUpperCase();
  if (!/^[A-Z]{3}$/.test(iata)) {
    issues.push({
      path: `${path}.iata`,
      code: 'iata',
      message: `${path} IATA 코드는 영문 3자여야 합니다.`,
    });
  }

  const rawCountryCode = text(airport.countryCode);
  const countryCode = rawCountryCode.toUpperCase();
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
    issues.push({
      path: `${path}.countryCode`,
      code: 'country_code',
      message: `${path} 국가 코드는 ISO 영문 2자여야 합니다.`,
    });
  }

  const latitude = optionalCoordinate(airport.latitude, `${path}.latitude`, -90, 90, issues);
  const longitude = optionalCoordinate(airport.longitude, `${path}.longitude`, -180, 180, issues);
  if ((latitude === null) !== (longitude === null)) {
    issues.push({
      path,
      code: 'coordinate_pair',
      message: `${path} 위도와 경도는 함께 입력해야 합니다.`,
    });
  }

  const timezoneId = optionalTimeZoneId(
    airport.timezoneId,
    `${path}.timezoneId`,
    issues,
  );

  return {
    iata,
    name: text(airport.name),
    municipality: text(airport.municipality),
    countryCode,
    countryName: text(airport.countryName),
    latitude,
    longitude,
    ...(timezoneId ? { timezoneId } : {}),
  };
}

/**
 * Capture a detached point-in-time airport snapshot. A coordinate tuple from
 * the lean map index can be combined with rich lazy-loaded search metadata.
 */
export function createManualAirportSnapshot(
  value: ManualAirportSnapshotSource | unknown,
  coordinate?: readonly [latitude: number, longitude: number],
): ManualAirportSnapshot {
  const source = isRecord(value) ? value : {};
  const issues: ManualFlightValidationIssue[] = [];
  const snapshot = normalizeAirport(
    coordinate
      ? { ...source, latitude: coordinate[0], longitude: coordinate[1] }
      : source,
    'airport',
    issues,
  );
  if (issues.length) throw new ManualFlightValidationError(issues);
  return freezeAirport(snapshot);
}

function normalizedInput(value: unknown): ManualFlightInput & {
  airline: string;
  flightNumber: string;
  aircraft: string;
  type: FlightType;
} {
  const issues: ManualFlightValidationIssue[] = [];
  const input = isRecord(value) ? value : {};
  if (!isRecord(value)) {
    issues.push({ path: '', code: 'record', message: '비행 기록 형식이 올바르지 않습니다.' });
  }

  const date = text(input.date);
  if (!isValidDateOnly(date)) {
    issues.push({
      path: 'date',
      code: 'date_only',
      message: '날짜는 YYYY-MM-DD 형식의 올바른 날짜여야 합니다.',
    });
  }

  const departureTime = optionalTime(input.departureTime, issues);

  const departure = normalizeAirport(input.departure, 'departure', issues);
  const arrival = normalizeAirport(input.arrival, 'arrival', issues);
  if (departure.iata && departure.iata === arrival.iata) {
    issues.push({
      path: 'arrival.iata',
      code: 'same_airport',
      message: '출발 공항과 도착 공항은 달라야 합니다.',
    });
  }

  const inferredType = inferManualFlightType(departure, arrival);
  const explicitType = input.type === '국내선' || input.type === '국제선' ? input.type : null;
  if (inferredType && explicitType && explicitType !== inferredType) {
    issues.push({
      path: 'type',
      code: 'classification_conflict',
      message: '국내선/국제선 구분이 공항 국가 정보와 일치하지 않습니다.',
    });
  } else if (!inferredType && !explicitType) {
    issues.push({
      path: 'type',
      code: 'classification_required',
      message: '국가 정보가 없는 공항은 국내선 또는 국제선을 선택해야 합니다.',
    });
  }


  if (departureTime && departure.timezoneId && isValidDateOnly(date)) {
    const resolution = resolveDepartureLocalDateTime(
      date,
      departureTime,
      departure.timezoneId,
    );
    if (resolution.status === 'invalid') {
      issues.push({
        path: 'departureTime',
        code: resolution.reason === 'nonexistent_local_time'
          ? 'nonexistent_local_time'
          : 'departure_datetime',
        message: resolution.reason === 'nonexistent_local_time'
          ? '이 현지 출발 시간은 서머타임 전환으로 존재하지 않습니다.'
          : '출발 공항의 현지 날짜와 시간을 해석할 수 없습니다.',
      });
    }
  }

  const airline = text(input.airline);
  const airlineSnapshot = normalizeAirlineSnapshot(
    input.airlineSnapshot,
    airline,
    issues,
  );

  if (issues.length) throw new ManualFlightValidationError(issues);
  return {
    date,
    ...(departureTime ? { departureTime } : {}),
    departure,
    arrival,
    airline,
    ...(airlineSnapshot ? { airlineSnapshot } : {}),
    flightNumber: text(input.flightNumber),
    aircraft: text(input.aircraft),
    type: inferredType ?? explicitType!,
  };
}

export function inferManualFlightType(
  departure: Pick<ManualAirportSnapshot, 'countryCode'>,
  arrival: Pick<ManualAirportSnapshot, 'countryCode'>,
): InferredManualFlightClassification {
  const departureCountry = departure.countryCode.trim().toUpperCase();
  const arrivalCountry = arrival.countryCode.trim().toUpperCase();
  if (!departureCountry || !arrivalCountry) return null;
  return departureCountry === arrivalCountry ? '국내선' : '국제선';
}

function defaultId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (!cryptoApi?.getRandomValues) {
    throw new Error('안전한 비행 기록 ID를 만들 수 없습니다.');
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonicalInstant(factory: (() => Date) | undefined): string {
  const date = factory ? factory() : new Date();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error('현재 시각을 읽을 수 없습니다.');
  }
  return date.toISOString();
}

function freezeAirport(airport: ManualAirportSnapshot): ManualAirportSnapshot {
  return Object.freeze({ ...airport });
}

function freezeRecord(record: ManualFlightRecord): ManualFlightRecord {
  return Object.freeze({
    ...record,
    departure: freezeAirport(record.departure),
    arrival: freezeAirport(record.arrival),
    ...(record.airlineSnapshot
      ? { airlineSnapshot: Object.freeze({ ...record.airlineSnapshot }) }
      : {}),
  });
}

export function createManualFlight(
  value: ManualFlightInput | unknown,
  factories: ManualFlightFactories = {},
): ManualFlightRecord {
  const input = normalizedInput(value);
  const id = text((factories.generateId ?? defaultId)());
  if (!id || id.length > 128 || hasUnsafeIdCharacter(id)) {
    throw new ManualFlightValidationError([
      { path: 'id', code: 'id', message: '비행 기록 ID가 올바르지 않습니다.' },
    ]);
  }
  const timestamp = canonicalInstant(factories.now);
  return freezeRecord({
    schemaVersion: MANUAL_FLIGHT_SCHEMA_VERSION,
    id,
    ...input,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function updateManualFlight(
  currentValue: ManualFlightRecord | unknown,
  nextValue: ManualFlightInput | unknown,
  factories: Pick<ManualFlightFactories, 'now'> = {},
): ManualFlightRecord {
  const current = validateManualFlightRecord(currentValue);
  const input = normalizedInput(nextValue);
  const requestedUpdatedAt = canonicalInstant(factories.now);
  const requestedUpdatedAtMs = Date.parse(requestedUpdatedAt);
  const currentUpdatedAtMs = Date.parse(current.updatedAt);
  const updatedAt = new Date(
    requestedUpdatedAtMs > currentUpdatedAtMs
      ? requestedUpdatedAtMs
      : currentUpdatedAtMs + 1,
  ).toISOString();
  return freezeRecord({
    schemaVersion: MANUAL_FLIGHT_SCHEMA_VERSION,
    id: current.id,
    ...input,
    createdAt: current.createdAt,
    updatedAt,
  });
}

function withoutV2Fields(value: UnknownRecord): UnknownRecord {
  const withoutAirportTimezone = (airport: unknown): unknown => {
    if (!isRecord(airport)) return airport;
    const legacyAirport = { ...airport };
    delete legacyAirport.timezoneId;
    return legacyAirport;
  };
  const legacyRecord = { ...value };
  delete legacyRecord.departureTime;
  delete legacyRecord.airlineSnapshot;
  return {
    ...legacyRecord,
    departure: withoutAirportTimezone(value.departure),
    arrival: withoutAirportTimezone(value.arrival),
  };
}

/** Validate/migrate and return a detached, immutable canonical V2 record. */
export function validateManualFlightRecord(value: unknown): ManualFlightRecord {
  const issues: ManualFlightValidationIssue[] = [];
  if (!isRecord(value)) {
    throw new ManualFlightValidationError([
      { path: '', code: 'record', message: '비행 기록 형식이 올바르지 않습니다.' },
    ]);
  }

  const sourceVersion = value.schemaVersion;
  if (
    sourceVersion !== LEGACY_MANUAL_FLIGHT_SCHEMA_VERSION
    && sourceVersion !== MANUAL_FLIGHT_SCHEMA_VERSION
  ) {
    issues.push({
      path: 'schemaVersion',
      code: 'schema_version',
      message: '지원하지 않는 비행 기록 버전입니다.',
    });
  }

  const id = text(value.id);
  if (!id || id.length > 128 || hasUnsafeIdCharacter(id)) {
    issues.push({ path: 'id', code: 'id', message: '비행 기록 ID가 올바르지 않습니다.' });
  }

  let input: ReturnType<typeof normalizedInput> | null = null;
  try {
    // V1 backups predate time/timezone/airline snapshots. Ignore any fields
    // claiming those semantics unless the record explicitly opts into V2.
    input = normalizedInput(
      sourceVersion === LEGACY_MANUAL_FLIGHT_SCHEMA_VERSION
        ? withoutV2Fields(value)
        : value,
    );
  } catch (error) {
    if (error instanceof ManualFlightValidationError) issues.push(...error.issues);
    else throw error;
  }

  const createdAt = text(value.createdAt);
  const updatedAt = text(value.updatedAt);
  if (!isIsoInstant(createdAt)) {
    issues.push({ path: 'createdAt', code: 'timestamp', message: 'createdAt 시각이 올바르지 않습니다.' });
  }
  if (!isIsoInstant(updatedAt)) {
    issues.push({ path: 'updatedAt', code: 'timestamp', message: 'updatedAt 시각이 올바르지 않습니다.' });
  }
  if (isIsoInstant(createdAt) && isIsoInstant(updatedAt) && Date.parse(updatedAt) < Date.parse(createdAt)) {
    issues.push({
      path: 'updatedAt',
      code: 'timestamp_order',
      message: 'updatedAt은 createdAt보다 이를 수 없습니다.',
    });
  }

  if (issues.length || !input) throw new ManualFlightValidationError(issues);
  return freezeRecord({
    schemaVersion: MANUAL_FLIGHT_SCHEMA_VERSION,
    id,
    ...input,
    createdAt,
    updatedAt,
  });
}

function numericId(stableId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < stableId.length; index += 1) {
    hash ^= stableId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Adapt one validated session record to the existing visualization domain. Records
 * without inferable country data have already required an explicit route type.
 */
export function manualFlightToFlight(
  recordValue: ManualFlightRecord | unknown,
  visualizationId?: number,
): ManualAdaptedFlight {
  const record = validateManualFlightRecord(recordValue);
  const displayDate = record.date.replace(/-/g, '.');
  const airlineSnapshot = record.airlineSnapshot;
  return {
    id: visualizationId ?? numericId(record.id),
    manualId: record.id,
    classificationKnown: true,
    type: record.type,
    fc: record.departure.countryName || record.departure.countryCode,
    tc: record.arrival.countryName || record.arrival.countryCode,
    fcity: record.departure.municipality,
    tcity: record.arrival.municipality,
    fa: record.departure.iata,
    ta: record.arrival.iata,
    al: record.airline,
    nat: '',
    fn: record.flightNumber,
    ac: record.aircraft,
    d: displayDate,
    y: Number(record.date.slice(0, 4)),
    ...(record.departureTime ? { departureTime: record.departureTime } : {}),
    ...(record.departure.timezoneId
      ? { departureTimeZoneId: record.departure.timezoneId }
      : {}),
    ...(record.arrival.timezoneId
      ? { arrivalTimeZoneId: record.arrival.timezoneId }
      : {}),
    ...(airlineSnapshot?.iata ? { airlineIata: airlineSnapshot.iata } : {}),
    ...(airlineSnapshot?.icao ? { airlineIcao: airlineSnapshot.icao } : {}),
    sortKey: record.departureTime
      ? `${displayDate} ${record.departureTime}`
      : displayDate,
    departureSnapshot: record.departure,
    arrivalSnapshot: record.arrival,
  };
}

/**
 * Assign source-order numeric IDs, matching the legacy parser. Repository list
 * order is date/createdAt/ID, so same-day playback and timeline ties stay deliberate.
 */
export function manualFlightsToFlights(
  records: readonly ManualFlightRecord[],
): ManualAdaptedFlight[] {
  return records.map((record, index) => manualFlightToFlight(record, index));
}
