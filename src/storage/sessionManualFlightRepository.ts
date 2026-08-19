import {
  createManualFlight,
  updateManualFlight,
  validateManualFlightRecord,
} from '../lib/manualFlight';
import type {
  ManualFlightFactories,
  ManualFlightInput,
  ManualFlightRecord,
} from '../lib/manualFlight';

export interface ManualFlightMergeResult {
  added: number;
  updated: number;
  skipped: number;
  total: number;
}

/**
 * The manual-flight data boundary used by the UI and local file workflows.
 * Implementations may be asynchronous, but V1.3 intentionally provides only
 * an in-memory implementation so a new page instance always starts empty.
 */
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
  readonly code: 'not_found' | 'duplicate_id';

  constructor(code: ManualFlightRepositoryError['code'], message: string) {
    super(message);
    this.name = 'ManualFlightRepositoryError';
    this.code = code;
  }
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

/** Mirror repository merge semantics without mutating either input. */
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

/**
 * Authoritative manual-flight archive for one loaded page instance.
 *
 * This class deliberately has no IndexedDB, localStorage, sessionStorage,
 * cookie, URL, or network dependency. The obsolete
 * `personal-flight-log-manual` IndexedDB database is neither opened nor
 * deleted: older data stays dormant and can never populate this repository.
 */
export class InMemoryManualFlightRepository implements ManualFlightRepository {
  private records = new Map<string, ManualFlightRecord>();
  private readonly factories: ManualFlightFactories;

  constructor(factories: ManualFlightFactories = {}) {
    this.factories = factories;
  }

  async list(): Promise<ManualFlightRecord[]> {
    return sortManualFlightRecords([...this.records.values()]);
  }

  async get(id: string): Promise<ManualFlightRecord | undefined> {
    return this.records.get(id);
  }

  async add(input: ManualFlightInput | unknown): Promise<ManualFlightRecord> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const record = createManualFlight(input, this.factories);
      if (!this.records.has(record.id)) {
        this.records.set(record.id, record);
        return record;
      }
    }
    throw new ManualFlightRepositoryError('duplicate_id', '고유한 비행 기록 ID를 만들지 못했습니다.');
  }

  async update(id: string, input: ManualFlightInput | unknown): Promise<ManualFlightRecord> {
    const current = this.records.get(id);
    if (!current) {
      throw new ManualFlightRepositoryError('not_found', `비행 기록을 찾을 수 없습니다: ${id}`);
    }
    const updated = updateManualFlight(current, input, this.factories);
    this.records.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.records.delete(id);
  }

  async clear(): Promise<void> {
    this.records.clear();
  }

  async replaceAll(values: readonly unknown[]): Promise<ManualFlightRecord[]> {
    const records = values.map((value) => validateManualFlightRecord(value));
    assertUniqueIds(records);
    this.records = new Map(records.map((record) => [record.id, record]));
    return sortManualFlightRecords(records);
  }

  async merge(values: readonly unknown[]): Promise<ManualFlightMergeResult> {
    const incoming = values.map((value) => validateManualFlightRecord(value));
    assertUniqueIds(incoming);

    const next = new Map(this.records);
    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const record of incoming) {
      const existing = next.get(record.id);
      if (!existing) {
        next.set(record.id, record);
        added += 1;
      } else if (Date.parse(record.updatedAt) > Date.parse(existing.updatedAt)) {
        next.set(record.id, record);
        updated += 1;
      } else {
        skipped += 1;
      }
    }

    this.records = next;
    return { added, updated, skipped, total: next.size };
  }

  close(): void {
    this.records.clear();
  }
}

export function createSessionManualFlightRepository(
  factories: ManualFlightFactories = {},
): InMemoryManualFlightRepository {
  return new InMemoryManualFlightRepository(factories);
}
