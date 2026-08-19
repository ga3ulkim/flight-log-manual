import {
  MANUAL_FLIGHT_SCHEMA_VERSION,
  ManualFlightValidationError,
  createManualFlight,
  inferManualFlightType,
  updateManualFlight,
  validateManualFlightRecord,
} from '../lib/manualFlight';
import type {
  ManualFlightFactories,
  ManualFlightInput,
  ManualFlightRecord,
} from '../lib/manualFlight';

export const MANUAL_FLIGHT_DATABASE_NAME = 'personal-flight-log-manual';
export const MANUAL_FLIGHT_DATABASE_VERSION = 1;
export const MANUAL_FLIGHT_STORE_NAME = 'manualFlights';

export type ManualDatabaseMigrationStep = 'create-v1-flight-store';

/** Pure migration plan used by both the native upgrade hook and unit tests. */
export function manualDatabaseMigrationSteps(
  oldVersion: number,
  newVersion = MANUAL_FLIGHT_DATABASE_VERSION,
): ManualDatabaseMigrationStep[] {
  if (!Number.isInteger(oldVersion) || oldVersion < 0 || newVersion < oldVersion) {
    throw new Error('IndexedDB 버전 범위가 올바르지 않습니다.');
  }
  return oldVersion < 1 && newVersion >= 1 ? ['create-v1-flight-store'] : [];
}

export interface ManualFlightStorageChangeSet {
  clear?: boolean;
  puts?: readonly ManualFlightRecord[];
  deletes?: readonly string[];
}

/** Small injectable boundary; tests can use an in-memory adapter without DOM shims. */
export interface ManualFlightStorageAdapter {
  list(): Promise<readonly unknown[]>;
  get(id: string): Promise<unknown | undefined>;
  apply(changes: ManualFlightStorageChangeSet): Promise<void>;
  close?(): void;
}

export interface ManualFlightMergeResult {
  added: number;
  updated: number;
  skipped: number;
  total: number;
}

export interface ManualFlightRepository {
  list(): Promise<ManualFlightRecord[]>;
  get(id: string): Promise<ManualFlightRecord | undefined>;
  add(input: ManualFlightInput | unknown): Promise<ManualFlightRecord>;
  update(id: string, input: ManualFlightInput | unknown): Promise<ManualFlightRecord>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
  replaceAll(records: readonly unknown[]): Promise<ManualFlightRecord[]>;
  merge(records: readonly unknown[]): Promise<ManualFlightMergeResult>;
  close(): void;
}

export class ManualFlightRepositoryError extends Error {
  readonly code: 'not_found' | 'duplicate_id' | 'storage';

  constructor(code: ManualFlightRepositoryError['code'], message: string) {
    super(message);
    this.name = 'ManualFlightRepositoryError';
    this.code = code;
  }
}

function validTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return /^\d{4}-\d{2}-\d{2}T/.test(value) ? value : null;
}

/**
 * Upgrade the only pre-release record shape (schemaVersion absent/0) to V1.
 * Airport snapshots are copied, never refreshed from the mutable public index.
 */
export function migrateStoredManualFlight(
  value: unknown,
  now: () => Date = () => new Date(),
): ManualFlightRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return validateManualFlightRecord(value);
  }
  const source = value as Record<string, unknown>;
  if (source.schemaVersion === MANUAL_FLIGHT_SCHEMA_VERSION) {
    return validateManualFlightRecord(source);
  }
  if (source.schemaVersion != null && source.schemaVersion !== 0) {
    return validateManualFlightRecord(source);
  }

  const migrationTime = now();
  if (!(migrationTime instanceof Date) || !Number.isFinite(migrationTime.getTime())) {
    throw new Error('마이그레이션 시각이 올바르지 않습니다.');
  }
  const fallbackTimestamp = migrationTime.toISOString();
  const departure = source.departure;
  const arrival = source.arrival;
  const departureRecord = typeof departure === 'object' && departure !== null
    ? departure as Record<string, unknown>
    : {};
  const arrivalRecord = typeof arrival === 'object' && arrival !== null
    ? arrival as Record<string, unknown>
    : {};

  return validateManualFlightRecord({
    schemaVersion: MANUAL_FLIGHT_SCHEMA_VERSION,
    id: source.id,
    date: source.date,
    departure,
    arrival,
    type: inferManualFlightType(
      { countryCode: typeof departureRecord.countryCode === 'string' ? departureRecord.countryCode : '' },
      { countryCode: typeof arrivalRecord.countryCode === 'string' ? arrivalRecord.countryCode : '' },
    ) ?? source.type,
    airline: source.airline ?? '',
    flightNumber: source.flightNumber ?? '',
    aircraft: source.aircraft ?? '',
    createdAt: validTimestamp(source.createdAt) ?? fallbackTimestamp,
    updatedAt: validTimestamp(source.updatedAt)
      ?? validTimestamp(source.createdAt)
      ?? fallbackTimestamp,
  });
}

function assertUniqueIds(records: readonly ManualFlightRecord[]): void {
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id)) {
      throw new ManualFlightRepositoryError(
        'duplicate_id',
        `중복된 비행 기록 ID가 있습니다: ${record.id}`,
      );
    }
    ids.add(record.id);
  }
}

export function sortManualFlightRecords(
  records: readonly ManualFlightRecord[],
): ManualFlightRecord[] {
  return [...records].sort((left, right) =>
    left.date.localeCompare(right.date)
    || Date.parse(left.createdAt) - Date.parse(right.createdAt)
    || left.id.localeCompare(right.id));
}

/** Mirror repository merge semantics for a committed-write UI fallback. */
export function mergeManualFlightRecords(
  current: readonly ManualFlightRecord[],
  incoming: readonly ManualFlightRecord[],
): ManualFlightRecord[] {
  const merged = new Map(current.map((record) => [record.id, record]));
  for (const record of incoming) {
    const existing = merged.get(record.id);
    if (!existing || Date.parse(record.updatedAt) > Date.parse(existing.updatedAt)) {
      merged.set(record.id, record);
    }
  }
  return sortManualFlightRecords([...merged.values()]);
}

function recordChangedByMigration(value: unknown): boolean {
  return typeof value !== 'object'
    || value === null
    || (value as Record<string, unknown>).schemaVersion !== MANUAL_FLIGHT_SCHEMA_VERSION;
}

export class ManualFlightRepositoryService implements ManualFlightRepository {
  private readonly storage: ManualFlightStorageAdapter;
  private readonly factories: ManualFlightFactories;

  constructor(storage: ManualFlightStorageAdapter, factories: ManualFlightFactories = {}) {
    this.storage = storage;
    this.factories = factories;
  }

  async list(): Promise<ManualFlightRecord[]> {
    const stored = await this.storage.list();
    const records = stored.map((value) => migrateStoredManualFlight(value, this.factories.now));
    assertUniqueIds(records);
    const migrated = records.filter((_record, index) => recordChangedByMigration(stored[index]));
    if (migrated.length) await this.storage.apply({ puts: migrated });
    return sortManualFlightRecords(records);
  }

  async get(id: string): Promise<ManualFlightRecord | undefined> {
    const value = await this.storage.get(id);
    if (value === undefined) return undefined;
    const record = migrateStoredManualFlight(value, this.factories.now);
    if (recordChangedByMigration(value)) await this.storage.apply({ puts: [record] });
    return record;
  }

  async add(input: ManualFlightInput | unknown): Promise<ManualFlightRecord> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const record = createManualFlight(input, this.factories);
      if (await this.storage.get(record.id) === undefined) {
        await this.storage.apply({ puts: [record] });
        return record;
      }
    }
    throw new ManualFlightRepositoryError('duplicate_id', '고유한 비행 기록 ID를 만들지 못했습니다.');
  }

  async update(id: string, input: ManualFlightInput | unknown): Promise<ManualFlightRecord> {
    const current = await this.get(id);
    if (!current) {
      throw new ManualFlightRepositoryError('not_found', `비행 기록을 찾을 수 없습니다: ${id}`);
    }
    const updated = updateManualFlight(current, input, this.factories);
    await this.storage.apply({ puts: [updated] });
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const exists = await this.storage.get(id) !== undefined;
    if (exists) await this.storage.apply({ deletes: [id] });
    return exists;
  }

  async clear(): Promise<void> {
    await this.storage.apply({ clear: true });
  }

  async replaceAll(values: readonly unknown[]): Promise<ManualFlightRecord[]> {
    const records = values.map((value) => validateManualFlightRecord(value));
    assertUniqueIds(records);
    await this.storage.apply({ clear: true, puts: records });
    return sortManualFlightRecords(records);
  }

  async merge(values: readonly unknown[]): Promise<ManualFlightMergeResult> {
    const incoming = values.map((value) => validateManualFlightRecord(value));
    assertUniqueIds(incoming);
    const current = await this.list();
    const currentById = new Map(current.map((record) => [record.id, record]));
    const puts: ManualFlightRecord[] = [];
    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const record of incoming) {
      const existing = currentById.get(record.id);
      if (!existing) {
        puts.push(record);
        added += 1;
      } else if (Date.parse(record.updatedAt) > Date.parse(existing.updatedAt)) {
        puts.push(record);
        updated += 1;
      } else {
        skipped += 1;
      }
    }

    if (puts.length) await this.storage.apply({ puts });
    return { added, updated, skipped, total: current.length + added };
  }

  close(): void {
    this.storage.close?.();
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 요청에 실패했습니다.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 트랜잭션에 실패했습니다.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 트랜잭션이 취소되었습니다.'));
  });
}

export interface IndexedDbManualFlightStorageOptions {
  indexedDB?: IDBFactory;
  databaseName?: string;
}

/** Native IndexedDB adapter. No flight data leaves the browser. */
export class IndexedDbManualFlightStorage implements ManualFlightStorageAdapter {
  private readonly factory: IDBFactory | undefined;
  private readonly databaseName: string;
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbManualFlightStorageOptions = {}) {
    this.factory = options.indexedDB ?? globalThis.indexedDB;
    this.databaseName = options.databaseName ?? MANUAL_FLIGHT_DATABASE_NAME;
  }

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    if (!this.factory) {
      return Promise.reject(new ManualFlightRepositoryError(
        'storage',
        '이 브라우저에서는 IndexedDB를 사용할 수 없습니다.',
      ));
    }

    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory!.open(this.databaseName, MANUAL_FLIGHT_DATABASE_VERSION);
      request.onupgradeneeded = (event) => {
        const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
        const database = request.result;
        for (const step of manualDatabaseMigrationSteps(oldVersion)) {
          if (step === 'create-v1-flight-store') {
            const store = database.createObjectStore(MANUAL_FLIGHT_STORE_NAME, { keyPath: 'id' });
            store.createIndex('date', 'date', { unique: false });
            store.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => {
        this.databasePromise = null;
        reject(request.error ?? new Error('비행 기록 저장소를 열지 못했습니다.'));
      };
      request.onblocked = () => {
        this.databasePromise = null;
        reject(new Error('다른 탭이 이전 비행 기록 저장소를 사용 중입니다.'));
      };
    });
    return this.databasePromise;
  }

  async list(): Promise<readonly unknown[]> {
    const database = await this.open();
    const transaction = database.transaction(MANUAL_FLIGHT_STORE_NAME, 'readonly');
    const completion = transactionComplete(transaction);
    const records = await requestResult(transaction.objectStore(MANUAL_FLIGHT_STORE_NAME).getAll());
    await completion;
    return records;
  }

  async get(id: string): Promise<unknown | undefined> {
    const database = await this.open();
    const transaction = database.transaction(MANUAL_FLIGHT_STORE_NAME, 'readonly');
    const completion = transactionComplete(transaction);
    const record = await requestResult(transaction.objectStore(MANUAL_FLIGHT_STORE_NAME).get(id));
    await completion;
    return record;
  }

  async apply(changes: ManualFlightStorageChangeSet): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(MANUAL_FLIGHT_STORE_NAME, 'readwrite');
    const completion = transactionComplete(transaction);
    const store = transaction.objectStore(MANUAL_FLIGHT_STORE_NAME);
    if (changes.clear) store.clear();
    for (const id of changes.deletes ?? []) store.delete(id);
    for (const record of changes.puts ?? []) store.put(record);
    await completion;
  }

  close(): void {
    if (!this.databasePromise) return;
    void this.databasePromise.then((database) => database.close());
    this.databasePromise = null;
  }
}

export interface IndexedDbManualFlightRepositoryOptions extends IndexedDbManualFlightStorageOptions {
  factories?: ManualFlightFactories;
}

export function createIndexedDbManualFlightRepository(
  options: IndexedDbManualFlightRepositoryOptions = {},
): ManualFlightRepositoryService {
  return new ManualFlightRepositoryService(
    new IndexedDbManualFlightStorage(options),
    options.factories,
  );
}

export { ManualFlightValidationError };
