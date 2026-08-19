import { describe, expect, it } from 'vitest';
import { createManualFlight, updateManualFlight } from '../lib/manualFlight';
import type {
  ManualAirportSnapshot,
  ManualFlightFactories,
  ManualFlightInput,
  ManualFlightRecord,
} from '../lib/manualFlight';
import {
  InMemoryManualFlightRepository,
  ManualFlightRepositoryError,
  createSessionManualFlightRepository,
  mergeManualFlightRecords,
  sortManualFlightRecords,
} from './sessionManualFlightRepository';
import {
  initialManualAppScreen,
  manualAppScreenAfterArchiveRequest,
  manualAppScreenAfterManagementRequest,
  manualAppScreenAfterMutation,
} from '../lib/manualEntryFlow';

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
  factories: ManualFlightFactories = {
    generateId: () => 'generated-id',
    now: () => new Date('2025-01-22T00:00:00Z'),
  },
): InMemoryManualFlightRepository {
  return createSessionManualFlightRepository(factories);
}

describe('session-only manual flight repository', () => {
  it('starts empty and a new page-session repository never inherits earlier records', async () => {
    const firstPage = repository();
    const added = await firstPage.add(input());
    expect(await firstPage.get(added.id)).toEqual(added);

    const refreshedPage = repository();
    const newTab = repository();
    expect(await refreshedPage.list()).toEqual([]);
    expect(await newTab.list()).toEqual([]);
    expect(await firstPage.list()).toEqual([added]);
  });

  it('never reads legacy IndexedDB or falls back to localStorage/sessionStorage', async () => {
    const names = ['indexedDB', 'localStorage', 'sessionStorage'] as const;
    const descriptors = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));

    try {
      for (const name of names) {
        Object.defineProperty(globalThis, name, {
          configurable: true,
          get: () => { throw new Error(`${name} must not be accessed`); },
        });
      }

      const repo = repository();
      expect(await repo.list()).toEqual([]);
      await repo.add(input());
      expect(await repo.list()).toHaveLength(1);
    } finally {
      for (const name of names) {
        const descriptor = descriptors.get(name);
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });

  it('keeps add, edit, and one-click delete authoritative within one page session', async () => {
    const timestamps = [
      new Date('2025-01-22T00:00:00Z'),
      new Date('2025-02-23T01:02:03Z'),
    ];
    const repo = repository({
      generateId: () => 'stable-id',
      now: () => timestamps.shift()!,
    });
    let screen = initialManualAppScreen();
    const added = await repo.add(input());
    screen = manualAppScreenAfterMutation(screen, (await repo.list()).length);
    expect(await repo.list()).toEqual([added]);
    expect(screen).toBe('entry');

    screen = manualAppScreenAfterArchiveRequest((await repo.list()).length);
    expect(screen).toBe('archive');
    expect(await repo.list()).toEqual([added]);

    screen = manualAppScreenAfterManagementRequest();
    expect(screen).toBe('entry');

    const updated = await repo.update(added.id, input({ aircraft: 'B787-9' }));
    expect(updated).toMatchObject({
      id: added.id,
      createdAt: added.createdAt,
      updatedAt: '2025-02-23T01:02:03.000Z',
      aircraft: 'B787-9',
    });
    expect(await repo.list()).toEqual([updated]);

    screen = manualAppScreenAfterArchiveRequest((await repo.list()).length);
    expect(screen).toBe('archive');
    expect(await repo.delete(added.id)).toBe(true);
    screen = manualAppScreenAfterMutation(screen, (await repo.list()).length);
    expect(await repo.list()).toEqual([]);
    expect(screen).toBe('entry');
    expect(await repo.delete(added.id)).toBe(false);
  });

  it('uses stable unique IDs and refuses to overwrite on repeated collisions', async () => {
    const repo = repository({
      generateId: () => 'same-id',
      now: () => new Date('2025-01-22T00:00:00Z'),
    });
    await repo.add(input());
    await expect(repo.add(input({ date: '2025-01-23' }))).rejects.toMatchObject({
      code: 'duplicate_id',
    });
    expect(await repo.list()).toHaveLength(1);
    await expect(repo.update('missing', input())).rejects.toBeInstanceOf(ManualFlightRepositoryError);
  });

  it('validates before changes and atomically rejects invalid replacement input', async () => {
    const repo = repository();
    await expect(repo.add(input({ date: '2025-02-30' }))).rejects.toThrow(/날짜/);
    expect(await repo.list()).toEqual([]);

    const current = saved('current');
    const replacement = saved('replacement', '2025-03-01T00:00:00Z');
    await repo.replaceAll([current]);
    expect(await repo.replaceAll([replacement])).toEqual([replacement]);
    await expect(repo.replaceAll([current, current])).rejects.toMatchObject({
      code: 'duplicate_id',
    });
    expect((await repo.list()).map((flight) => flight.id)).toEqual(['replacement']);
  });

  it('merges restored/imported records in session, while a reinitialized session is empty', async () => {
    const repo = repository();
    const current = saved('shared', '2025-01-01T00:00:00Z');
    await repo.replaceAll([current]);
    const newer = updateManualFlight(current, input({ airline: 'Newer' }), {
      now: () => new Date('2025-02-01T00:00:00Z'),
    });
    const imported = saved('imported', '2025-01-15T00:00:00Z');

    expect(await repo.merge([newer, imported])).toEqual({
      added: 1,
      updated: 1,
      skipped: 0,
      total: 2,
    });
    expect((await repo.get('shared'))?.airline).toBe('Newer');
    expect(await repo.merge([current])).toMatchObject({ added: 0, updated: 0, skipped: 1, total: 2 });
    expect(await repo.list()).toHaveLength(2);

    expect(await repository().list()).toEqual([]);
  });

  it('clears all current-session records and releases them on close', async () => {
    const repo = repository();
    await repo.replaceAll([saved('one'), saved('two', '2025-01-23T00:00:00Z')]);
    await repo.clear();
    expect(await repo.list()).toEqual([]);

    await repo.add(input());
    repo.close();
    expect(await repo.list()).toEqual([]);
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
