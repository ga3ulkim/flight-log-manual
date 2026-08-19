import { describe, expect, it, vi } from 'vitest';
import { createManualFlight } from './manualFlight';
import type { ManualFlightInput, ManualFlightRecord } from './manualFlight';
import {
  canEnterManualArchive,
  commitImmediateManualFlightDeletion,
  initialManualAppScreen,
  manualAppScreenAfterArchiveRequest,
  manualAppScreenAfterManagementRequest,
  manualAppScreenAfterMutation,
  manualEntryFlights,
} from './manualEntryFlow';

function input(date: string, from: string, to: string): ManualFlightInput {
  return {
    date,
    departure: {
      iata: from,
      name: `${from} Airport`,
      municipality: `${from} City`,
      countryCode: 'KR',
      countryName: '대한민국',
      latitude: 37,
      longitude: 127,
    },
    arrival: {
      iata: to,
      name: `${to} Airport`,
      municipality: `${to} City`,
      countryCode: 'JP',
      countryName: '일본',
      latitude: 35,
      longitude: 139,
    },
  };
}

function record(id: string, date: string, timestamp: string): ManualFlightRecord {
  return createManualFlight(input(date, id === 'older' ? 'ICN' : 'NRT', id === 'older' ? 'NRT' : 'ICN'), {
    generateId: () => id,
    now: () => new Date(timestamp),
  });
}

describe('manual entry navigation policy', () => {
  it('always opens Entry for empty, returning, and large archives', () => {
    for (const savedRecordCount of [0, 1, 10, 100]) {
      const initializedRecords = Array.from({ length: savedRecordCount });
      expect(initializedRecords).toHaveLength(savedRecordCount);
      expect(initialManualAppScreen()).toBe('entry');
    }
  });

  it('requires an explicit archive request and returns to Entry for management', () => {
    expect(manualAppScreenAfterArchiveRequest(0)).toBe('entry');
    expect(manualAppScreenAfterArchiveRequest(2)).toBe('archive');
    expect(manualAppScreenAfterManagementRequest()).toBe('entry');
  });

  it('reinitializes to Entry instead of restoring the last-viewed archive screen', () => {
    expect(manualAppScreenAfterArchiveRequest(10)).toBe('archive');
    expect(initialManualAppScreen()).toBe('entry');
  });

  it('never auto-navigates after consecutive entry-view mutations', () => {
    let screen = initialManualAppScreen();
    for (const count of [1, 2, 10, 10, 9]) {
      screen = manualAppScreenAfterMutation(screen, count);
      expect(screen).toBe('entry');
    }
  });

  it('keeps archive mutations in the archive unless the last record is removed', () => {
    expect(manualAppScreenAfterMutation('archive', 3)).toBe('archive');
    expect(manualAppScreenAfterMutation('archive', 0)).toBe('entry');
  });

  it('does not allow the empty dashboard transition', () => {
    expect(canEnterManualArchive(0)).toBe(false);
    expect(canEnterManualArchive(1)).toBe(true);
  });

  it('uses the same saved records and newest-first Timeline ordering', () => {
    const records = [
      record('older', '2024-08-20', '2024-08-20T01:00:00.000Z'),
      record('newer', '2024-08-31', '2024-08-31T01:00:00.000Z'),
    ];
    const flights = manualEntryFlights(records);
    expect(flights.map((flight) => flight.manualId)).toEqual(['newer', 'older']);
    expect(new Set(flights.map((flight) => flight.manualId))).toEqual(
      new Set(records.map((saved) => saved.id)),
    );
  });
});

describe('immediate manual-flight deletion', () => {
  it('calls the repository delete operation exactly once and derives the next list', async () => {
    const older = record('older', '2024-08-20', '2024-08-20T01:00:00.000Z');
    const newer = record('newer', '2024-08-31', '2024-08-31T01:00:00.000Z');
    const deleteRecord = vi.fn(async () => true);

    const result = await commitImmediateManualFlightDeletion(
      deleteRecord,
      [older, newer],
      newer.id,
    );

    expect(deleteRecord).toHaveBeenCalledTimes(1);
    expect(deleteRecord).toHaveBeenCalledWith(newer.id);
    expect(result.map((saved) => saved.id)).toEqual([older.id]);
    expect(manualAppScreenAfterMutation('entry', result.length)).toBe('entry');
  });

  it('naturally restores the empty Entry policy after deleting the final record', async () => {
    const only = record('only', '2024-08-20', '2024-08-20T01:00:00.000Z');
    const result = await commitImmediateManualFlightDeletion(
      async () => true,
      [only],
      only.id,
    );

    expect(result).toEqual([]);
    expect(manualAppScreenAfterMutation('entry', result.length)).toBe('entry');
    expect(canEnterManualArchive(result.length)).toBe(false);
  });

  it('does not derive a falsely deleted list when repository deletion fails', async () => {
    const only = record('only', '2024-08-20', '2024-08-20T01:00:00.000Z');
    const authoritative = [only];
    const failure = new Error('synthetic IndexedDB failure');

    await expect(commitImmediateManualFlightDeletion(
      async () => { throw failure; },
      authoritative,
      only.id,
    )).rejects.toThrow(failure);

    expect(authoritative.map((saved) => saved.id)).toEqual([only.id]);
  });
});
