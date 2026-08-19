import { validateManualFlightRecord } from './manualFlight';
import type { ManualFlightRecord } from './manualFlight';

export const MANUAL_CSV_HEADERS = [
  '국제선/국내선',
  '출발 국가',
  '출발 도시',
  '출발 공항',
  '도착 국가',
  '도착 도시',
  '도착 공항',
  '출발 일',
  '항공사',
  '항공사 국적',
  '편명',
  '비행기 기종',
] as const;

function airportCell(airport: ManualFlightRecord['departure']): string {
  return airport.name ? `${airport.iata} · ${airport.name}` : airport.iata;
}

function countryCell(airport: ManualFlightRecord['departure']): string {
  return airport.countryName || airport.countryCode;
}

export function manualFlightsToCsvRows(values: readonly unknown[]): string[][] {
  const rows: string[][] = [[...MANUAL_CSV_HEADERS]];
  for (const value of values) {
    const flight = validateManualFlightRecord(value);
    rows.push([
      flight.type,
      countryCell(flight.departure),
      flight.departure.municipality,
      airportCell(flight.departure),
      countryCell(flight.arrival),
      flight.arrival.municipality,
      airportCell(flight.arrival),
      `${flight.date.replace(/-/g, '.')}${
        flight.departureTime ? ` ${flight.departureTime}` : ''
      }`,
      flight.airline,
      '',
      flight.flightNumber,
      flight.aircraft,
    ]);
  }
  return rows;
}

function escapeCsvCell(value: string): string {
  // Quoting alone does not stop spreadsheet applications from evaluating a
  // formula. Prefix user-controlled formula-leading cells with the standard
  // text marker before applying RFC-style CSV quoting.
  const spreadsheetSafeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(spreadsheetSafeValue)
    ? `"${spreadsheetSafeValue.replace(/"/g, '""')}"`
    : spreadsheetSafeValue;
}

/** UTF-8 BOM is included by default for Korean spreadsheet compatibility. */
export function exportManualFlightsCsv(
  values: readonly unknown[],
  options: { includeBom?: boolean; lineEnding?: '\n' | '\r\n' } = {},
): string {
  const includeBom = options.includeBom ?? true;
  const lineEnding = options.lineEnding ?? '\r\n';
  const csv = manualFlightsToCsvRows(values)
    .map((row) => row.map(escapeCsvCell).join(','))
    .join(lineEnding);
  return `${includeBom ? '\uFEFF' : ''}${csv}${lineEnding}`;
}

export function manualCsvFileName(date: Date = new Date()): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error('CSV 파일 날짜가 올바르지 않습니다.');
  }
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `flight-log-${year}-${month}-${day}.csv`;
}
