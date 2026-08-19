import type { Flight } from '../types';
import type { ManualFlightRecord } from './manualFlight';
import { manualFlightsToFlights } from './manualFlight';
import { groupFlightsForTimeline } from './timeline';

export type ManualAppScreen = 'entry' | 'archive';

/** Fresh archives enter setup; returning archives open the existing dashboard. */
export function initialManualAppScreen(savedRecordCount: number): ManualAppScreen {
  return savedRecordCount > 0 ? 'archive' : 'entry';
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

/** Use the archive Timeline's established newest-first date and same-day ordering. */
export function manualEntryFlights(records: readonly ManualFlightRecord[]): Flight[] {
  return groupFlightsForTimeline(manualFlightsToFlights(records))
    .flatMap((group) => group.flights);
}
