import {
  MANUAL_FLIGHT_SCHEMA_VERSION,
  validateManualFlightRecord,
} from './manualFlight';
import type { ManualFlightRecord } from './manualFlight';
import type {
  ManualFlightMergeResult,
  ManualFlightRepository,
} from '../storage/sessionManualFlightRepository';

export const MANUAL_BACKUP_FORMAT = 'personal-flight-log-backup';
export const MANUAL_BACKUP_SCHEMA_VERSION = 1 as const;

export interface ManualFlightBackup {
  format: typeof MANUAL_BACKUP_FORMAT;
  schemaVersion: typeof MANUAL_BACKUP_SCHEMA_VERSION;
  flightSchemaVersion: typeof MANUAL_FLIGHT_SCHEMA_VERSION;
  exportedAt: string;
  flights: ManualFlightRecord[];
}

export type ManualBackupRestoreMode = 'merge' | 'replace';

export interface ManualBackupRestoreResult extends ManualFlightMergeResult {
  mode: ManualBackupRestoreMode;
  previousTotal: number;
}

export class ManualBackupValidationError extends Error {
  readonly code:
    | 'invalid_json'
    | 'invalid_format'
    | 'unsupported_version'
    | 'invalid_exported_at'
    | 'invalid_flights'
    | 'duplicate_id';

  constructor(code: ManualBackupValidationError['code'], message: string) {
    super(message);
    this.name = 'ManualBackupValidationError';
    this.code = code;
  }
}

function isoInstant(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
    && Number.isFinite(Date.parse(value));
}

function backupObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ManualBackupValidationError('invalid_format', '백업 파일 형식이 올바르지 않습니다.');
  }
  return value as Record<string, unknown>;
}

export function createManualFlightBackup(
  values: readonly unknown[],
  now: () => Date = () => new Date(),
): ManualFlightBackup {
  const flights = values.map((value) => validateManualFlightRecord(value));
  const ids = new Set<string>();
  for (const flight of flights) {
    if (ids.has(flight.id)) {
      throw new ManualBackupValidationError(
        'duplicate_id',
        `백업에 중복된 비행 기록 ID가 있습니다: ${flight.id}`,
      );
    }
    ids.add(flight.id);
  }
  const timestamp = now();
  if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) {
    throw new ManualBackupValidationError('invalid_exported_at', '백업 생성 시각이 올바르지 않습니다.');
  }
  return {
    format: MANUAL_BACKUP_FORMAT,
    schemaVersion: MANUAL_BACKUP_SCHEMA_VERSION,
    flightSchemaVersion: MANUAL_FLIGHT_SCHEMA_VERSION,
    exportedAt: timestamp.toISOString(),
    flights,
  };
}

/** Parse and deeply validate before any repository mutation occurs. */
export function validateManualFlightBackup(value: unknown): ManualFlightBackup {
  const source = backupObject(value);
  if (source.format !== MANUAL_BACKUP_FORMAT) {
    throw new ManualBackupValidationError('invalid_format', 'Flight Log JSON 백업 파일이 아닙니다.');
  }
  if (source.schemaVersion !== MANUAL_BACKUP_SCHEMA_VERSION) {
    throw new ManualBackupValidationError(
      'unsupported_version',
      '지원하지 않는 JSON 백업 버전입니다.',
    );
  }
  if (source.flightSchemaVersion !== MANUAL_FLIGHT_SCHEMA_VERSION) {
    throw new ManualBackupValidationError(
      'unsupported_version',
      '지원하지 않는 비행 기록 스키마 버전입니다.',
    );
  }
  if (!isoInstant(source.exportedAt)) {
    throw new ManualBackupValidationError('invalid_exported_at', '백업 생성 시각이 올바르지 않습니다.');
  }
  if (!Array.isArray(source.flights)) {
    throw new ManualBackupValidationError('invalid_flights', '백업의 비행 기록 목록이 올바르지 않습니다.');
  }

  let flights: ManualFlightRecord[];
  try {
    flights = source.flights.map((value) => validateManualFlightRecord(value));
  } catch (error) {
    throw new ManualBackupValidationError(
      'invalid_flights',
      error instanceof Error ? error.message : '백업에 잘못된 비행 기록이 있습니다.',
    );
  }

  const ids = new Set<string>();
  for (const flight of flights) {
    if (ids.has(flight.id)) {
      throw new ManualBackupValidationError(
        'duplicate_id',
        `백업에 중복된 비행 기록 ID가 있습니다: ${flight.id}`,
      );
    }
    ids.add(flight.id);
  }

  return {
    format: MANUAL_BACKUP_FORMAT,
    schemaVersion: MANUAL_BACKUP_SCHEMA_VERSION,
    flightSchemaVersion: MANUAL_FLIGHT_SCHEMA_VERSION,
    exportedAt: source.exportedAt,
    flights,
  };
}

export function parseManualFlightBackup(json: string): ManualFlightBackup {
  let value: unknown;
  try {
    value = JSON.parse(json.replace(/^\uFEFF/, ''));
  } catch {
    throw new ManualBackupValidationError('invalid_json', 'JSON 백업 파일을 읽을 수 없습니다.');
  }
  return validateManualFlightBackup(value);
}

export function serializeManualFlightBackup(backupValue: unknown): string {
  return `${JSON.stringify(validateManualFlightBackup(backupValue), null, 2)}\n`;
}

export async function exportManualFlightBackup(
  repository: Pick<ManualFlightRepository, 'list'>,
  now: () => Date = () => new Date(),
): Promise<ManualFlightBackup> {
  return createManualFlightBackup(await repository.list(), now);
}

/**
 * Restore only after full validation. Replace atomically swaps the current
 * session archive; merge keeps the current record unless the incoming
 * updatedAt is newer. Neither mode persists beyond this loaded page instance.
 */
export async function restoreManualFlightBackup(
  repository: Pick<ManualFlightRepository, 'list' | 'replaceAll' | 'merge'>,
  value: string | unknown,
  mode: ManualBackupRestoreMode,
): Promise<ManualBackupRestoreResult> {
  const backup = typeof value === 'string'
    ? parseManualFlightBackup(value)
    : validateManualFlightBackup(value);
  const previousTotal = (await repository.list()).length;

  if (mode === 'replace') {
    const records = await repository.replaceAll(backup.flights);
    return {
      mode,
      previousTotal,
      added: records.length,
      updated: 0,
      skipped: 0,
      total: records.length,
    };
  }

  const result = await repository.merge(backup.flights);
  return { mode, previousTotal, ...result };
}

export function manualBackupFileName(date: Date = new Date()): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error('백업 파일 날짜가 올바르지 않습니다.');
  }
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `flight-log-backup-${year}-${month}-${day}.json`;
}
