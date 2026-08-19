import type { Flight } from '../types';
import type { ManualFlightRecord } from './manualFlight';
import { manualFlightsToFlights } from './manualFlight';
import { groupFlightsForTimeline } from './timeline';

export type ManualAppScreen = 'entry' | 'archive';

/** Every application load begins in the record-management hub. */
export function initialManualAppScreen(): ManualAppScreen {
  return 'entry';
}

/** Mutations never auto-enter the archive, while an empty archive returns to setup. */
export function manualAppScreenAfterMutation(
  current: ManualAppScreen,
  savedRecordCount: number,
): ManualAppScreen {
  return savedRecordCount > 0 ? current : 'entry';
}

export function canEnterManualArchive(savedRecordCount: number): boolean {
  return savedRecordCount > 0;
}

export function manualAppScreenAfterArchiveRequest(
  savedRecordCount: number,
): ManualAppScreen {
  return canEnterManualArchive(savedRecordCount) ? 'archive' : 'entry';
}

export function manualAppScreenAfterManagementRequest(): ManualAppScreen {
  return 'entry';
}

export function manualEntryEditControlId(manualId: string): string {
  return `manual-entry-edit-${encodeURIComponent(manualId)}`;
}

/**
 * Commit one deletion before deriving a new visible record list. A rejected
 * repository transaction leaves the caller's authoritative list untouched.
 */
export async function commitImmediateManualFlightDeletion(
  deleteRecord: (manualId: string) => Promise<boolean>,
  records: readonly ManualFlightRecord[],
  manualId: string,
): Promise<ManualFlightRecord[]> {
  await deleteRecord(manualId);
  return records.filter((record) => record.id !== manualId);
}

/** Use the archive Timeline's established newest-first date and same-day ordering. */
export function manualEntryFlights(records: readonly ManualFlightRecord[]): Flight[] {
  return groupFlightsForTimeline(manualFlightsToFlights(records))
    .flatMap((group) => group.flights);
}
