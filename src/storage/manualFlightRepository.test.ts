import { describe, expect, it } from 'vitest';
import { createManualFlight, updateManualFlight } from '../lib/manualFlight';
import type {
  ManualAirportSnapshot,
  ManualFlightFactories,
  ManualFlightInput,
  ManualFlightRecord,
} from '../lib/manualFlight';
import {
  ManualFlightRepositoryError,
  ManualFlightRepositoryService,
  manualDatabaseMigrationSteps,
  mergeManualFlightRecords,
  sortManualFlightRecords,
} from './manualFlightRepository';
import type {
  ManualFlightStorageAdapter,
  ManualFlightStorageChangeSet,
} from './manualFlightRepository';

type MemoryState = Map<string, unknown>;

class MemoryStorage implements ManualFlightStorageAdapter {
  readonly state: MemoryState;
  failNextApply = false;

  constructor(state: MemoryState = new Map()) {
    this.state = state;
  }

  async list(): Promise<readonly unknown[]> {
    return [...this.state.values()].map((value) => structuredClone(value));
  }

  async get(id: string): Promise<unknown | undefined> {
    const value = this.state.get(id);
    return value === undefined ? undefined : structuredClone(value);
  }

  async apply(changes: ManualFlightStorageChangeSet): Promise<void> {
    if (this.failNextApply) {
      this.failNextApply = false;
      throw new Error('synthetic storage failure');
    }
    const next = changes.clear ? new Map<string, unknown>() : new Map(this.state);
    for (const id of changes.deletes ?? []) next.delete(id);
    for (const record of changes.puts ?? []) next.set(record.id, structuredClone(record));
    this.state.clear();
    for (const [id, value] of next) this.state.set(id, value);
  }
}

function airport(iata: string, countryCode: string): ManualAirportSnapshot {
  return {
    iata,
    name: `${iata} Airport`,
    municipality: `${iata} City`,
    countryCode,
    countryName: `Country ${countryCode}`,
    latitude: 35,
    longitude: 127,
  };
}

function input(overrides: Partial<ManualFlightInput> = {}): ManualFlightInput {
  return {
    date: '2025-01-21',
    departure: airport('ICN', 'KR'),
    arrival: airport('NRT', 'JP'),
    airline: 'Example Air',
    flightNumber: 'EX 1',
    aircraft: 'A321',
    ...overrides,
  };
}

function saved(
  id: string,
  timestamp = '2025-01-22T00:00:00Z',
  overrides: Partial<ManualFlightInput> = {},
): ManualFlightRecord {
  return createManualFlight(input(overrides), {
    generateId: () => id,
    now: () => new Date(timestamp),
  });
}

function repository(
  storage: MemoryStorage,
  factories: ManualFlightFactories = {
    generateId: () => 'generated-id',
    now: () => new Date('2025-01-22T00:00:00Z'),
  },
): ManualFlightRepositoryService {
  return new ManualFlightRepositoryService(storage, factories);
}

describe('manual flight repository service', () => {
  it('starts empty and persists an added record across repository reopen', async () => {
    const state: MemoryState = new Map();
    const first = repository(new MemoryStorage(state));
    expect(await first.list()).toEqual([]);

    const added = await first.add(input());
    first.close();
    const reopened = repository(new MemoryStorage(state));
    expect(await reopened.get(added.id)).toEqual(added);
    expect(await reopened.list()).toEqual([added]);
  });

  it('uses stable unique IDs and refuses to overwrite on repeated collisions', async () => {
    const storage = new MemoryStorage();
    const repo = repository(storage, {
      generateId: () => 'same-id',
      now: () => new Date('2025-01-22T00:00:00Z'),
    });
    await repo.add(input());
    await expect(repo.add(input({ date: '2025-01-23' }))).rejects.toMatchObject({
      code: 'duplicate_id',
    });
    expect(await repo.list()).toHaveLength(1);
  });

  it('updates content while preserving ID/createdAt and advancing updatedAt', async () => {
    const storage = new MemoryStorage();
    const timestamps = [
      new Date('2025-01-22T00:00:00Z'),
      new Date('2025-02-23T01:02:03Z'),
    ];
    const repo = repository(storage, {
      generateId: () => 'stable-id',
      now: () => timestamps.shift()!,
    });
    const added = await repo.add(input());
    const updated = await repo.update(added.id, input({ aircraft: 'B787-9' }));
    expect(updated).toMatchObject({
      id: added.id,
      createdAt: added.createdAt,
      updatedAt: '2025-02-23T01:02:03.000Z',
      aircraft: 'B787-9',
    });
    await expect(repo.update('missing', input())).rejects.toBeInstanceOf(ManualFlightRepositoryError);
  });

  it('deletes one record and clears all records', async () => {
    const storage = new MemoryStorage();
    const ids = ['one', 'two'];
    const repo = repository(storage, {
      generateId: () => ids.shift()!,
      now: () => new Date('2025-01-22T00:00:00Z'),
    });
    const first = await repo.add(input());
    await repo.add(input({ date: '2025-01-22' }));
    expect(await repo.delete(first.id)).toBe(true);
    expect(await repo.delete(first.id)).toBe(false);
    expect(await repo.list()).toHaveLength(1);
    await repo.clear();
    expect(await repo.list()).toEqual([]);
  });

  it('validates before writes and does not claim success after a failed write', async () => {
    const storage = new MemoryStorage();
    const repo = repository(storage);
    await expect(repo.add(input({ date: '2025-02-30' }))).rejects.toThrow(/날짜/);
    expect(await repo.list()).toEqual([]);

    storage.failNextApply = true;
    await expect(repo.add(input())).rejects.toThrow('synthetic storage failure');
    expect(await repo.list()).toEqual([]);
  });

  it('plans the V1 database upgrade and migrates a schema-0 record in place', async () => {
    expect(manualDatabaseMigrationSteps(0)).toEqual(['create-v1-flight-store']);
    expect(manualDatabaseMigrationSteps(1)).toEqual([]);

    const state: MemoryState = new Map();
    state.set('legacy-id', {
      schemaVersion: 0,
      id: 'legacy-id',
      date: '2024-04-05',
      departure: airport('ICN', 'KR'),
      arrival: airport('PUS', 'KR'),
      airline: ' Legacy Air ',
      flightNumber: '',
      aircraft: '',
    });
    const repo = repository(new MemoryStorage(state), {
      now: () => new Date('2025-01-01T00:00:00Z'),
    });
    const [migrated] = await repo.list();
    expect(migrated).toMatchObject({
      schemaVersion: 1,
      id: 'legacy-id',
      type: '국내선',
      airline: 'Legacy Air',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    expect(state.get('legacy-id')).toMatchObject({ schemaVersion: 1 });
  });

  it('atomically replaces records and rejects duplicate IDs without clearing current data', async () => {
    const storage = new MemoryStorage();
    const repo = repository(storage);
    await repo.replaceAll([saved('current')]);
    const replacement = saved('replacement', '2025-03-01T00:00:00Z');
    expect(await repo.replaceAll([replacement])).toEqual([replacement]);
    expect((await repo.list()).map((flight) => flight.id)).toEqual(['replacement']);

    await expect(repo.replaceAll([replacement, replacement])).rejects.toMatchObject({
      code: 'duplicate_id',
    });
    expect((await repo.list()).map((flight) => flight.id)).toEqual(['replacement']);
  });

  it('merges by stable ID with deterministic newer-updatedAt wins behavior', async () => {
    const storage = new MemoryStorage();
    const repo = repository(storage);
    const current = saved('shared', '2025-01-01T00:00:00Z');
    await repo.replaceAll([current]);
    const newer = updateManualFlight(current, input({ airline: 'Newer' }), {
      now: () => new Date('2025-02-01T00:00:00Z'),
    });
    const added = saved('new-id', '2025-01-15T00:00:00Z');

    expect(await repo.merge([newer, added])).toEqual({
      added: 1,
      updated: 1,
      skipped: 0,
      total: 2,
    });
    expect((await repo.get('shared'))?.airline).toBe('Newer');
    expect(await repo.merge([current])).toEqual({
      added: 0,
      updated: 0,
      skipped: 1,
      total: 2,
    });
  });

  it('reconstructs committed sort and merge state without mutating inputs', () => {
    const older = saved('shared', '2025-01-01T00:00:00Z');
    const newer = updateManualFlight(older, input({ airline: 'Newer' }), {
      now: () => new Date('2025-02-01T00:00:00Z'),
    });
    const added = saved('added', '2025-01-15T00:00:00Z', { date: '2024-12-31' });
    const current = [older];

    expect(mergeManualFlightRecords(current, [newer, added])).toEqual([added, newer]);
    expect(sortManualFlightRecords([older, added])).toEqual([added, older]);
    expect(current).toEqual([older]);
  });
});
