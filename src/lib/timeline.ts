import type { Flight } from '../types';

export interface FlightTimelineGroup {
  key: string;
  year: number | null;
  label: string;
  flights: Flight[];
}

export interface FlightTimelineDisclosure {
  groups: FlightTimelineGroup[];
  canToggle: boolean;
}

const UNKNOWN_YEAR_KEY = 'unknown';

function comparableDateKey(flight: Flight): string {
  if (flight.y == null) return '';

  const expectedPrefix = `${flight.y}.`;
  return flight.sortKey.startsWith(expectedPrefix)
    ? flight.sortKey
    : `${flight.y}.00.00`;
}

/**
 * Prepare an already-filtered collection for archive browsing.
 *
 * Playback intentionally remains oldest-first. The archive presents the same
 * records newest-first, keeps source-order semantics for same-day records by
 * reversing the numeric id tie-break, and places undated records last.
 */
export function groupFlightsForTimeline(
  flights: readonly Flight[],
): FlightTimelineGroup[] {
  const ordered = flights.slice().sort((a, b) => {
    if (a.y == null && b.y != null) return 1;
    if (a.y != null && b.y == null) return -1;

    const aDate = comparableDateKey(a);
    const bDate = comparableDateKey(b);
    if (aDate !== bDate) return aDate > bDate ? -1 : 1;
    return b.id - a.id;
  });

  const grouped = new Map<number | null, Flight[]>();
  ordered.forEach((flight) => {
    const year = flight.y;
    const group = grouped.get(year);
    if (group) group.push(flight);
    else grouped.set(year, [flight]);
  });

  return [...grouped.entries()].map(([year, groupFlights]) => ({
    key: year == null ? UNKNOWN_YEAR_KEY : String(year),
    year,
    label: year == null ? '날짜 미상' : String(year),
    flights: groupFlights,
  }));
}

/**
 * Limit the archive presentation without removing or re-sorting source data.
 * The collapsed preview is the first item from the existing newest-first
 * grouping, while expanded mode returns every matching record.
 */
export function timelineDisclosure(
  flights: readonly Flight[],
  expanded: boolean,
): FlightTimelineDisclosure {
  const groups = groupFlightsForTimeline(flights);
  if (expanded || flights.length <= 1 || groups.length === 0) {
    return { groups, canToggle: flights.length > 1 };
  }

  const firstGroup = groups[0];
  const firstFlight = firstGroup.flights[0];
  return {
    groups: firstFlight
      ? [{ ...firstGroup, flights: [firstFlight] }]
      : [],
    canToggle: true,
  };
}

const MONTH_LABELS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

export interface TimelineDateLabel {
  primary: string;
  dateTime?: string;
  accessible: string;
}

/** Format normalized parser output without inventing missing precision. */
export function timelineDateLabel(flight: Flight): TimelineDateLabel {
  if (!flight.d) {
    return { primary: '—', accessible: '날짜 미상' };
  }

  const fullDate = flight.d.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (fullDate) {
    const month = Number(fullDate[2]);
    const monthLabel = MONTH_LABELS[month - 1];
    if (monthLabel) {
      return {
        primary: `${monthLabel} ${fullDate[3]}`,
        dateTime: `${fullDate[1]}-${fullDate[2]}-${fullDate[3]}`,
        accessible: flight.d,
      };
    }
  }

  const monthDate = flight.d.match(/^(\d{4})\.(\d{2})$/);
  if (monthDate) {
    const month = Number(monthDate[2]);
    const monthLabel = MONTH_LABELS[month - 1];
    if (monthLabel) {
      return {
        primary: monthLabel,
        dateTime: `${monthDate[1]}-${monthDate[2]}`,
        accessible: flight.d,
      };
    }
  }

  if (/^\d{4}$/.test(flight.d)) {
    return {
      primary: '연도만 기록',
      dateTime: flight.d,
      accessible: flight.d,
    };
  }

  return { primary: flight.d, accessible: flight.d };
}
