import * as XLSX from 'xlsx';
import type { Flight, FlightType, ParseResult } from '../types';
import { parseDateInfo, parseIata } from './dateIata';

export interface ColumnMap {
  type?: number;
  fc?: number;
  fcity?: number;
  fa?: number;
  fd?: number;
  tc?: number;
  tcity?: number;
  ta?: number;
  nat?: number;
  al?: number;
  fn?: number;
  ac?: number;
}

const HEADER_ERROR =
  '헤더를 찾지 못했어요. "출발 공항", "도착 공항" 열이 필요합니다.';
const DATA_ERROR =
  '데이터 행을 읽지 못했어요. 공항 열에 IATA 코드(예: PUS)가 있어야 합니다.';

function cellString(value: unknown): string {
  return String(value || '');
}

function trimmedCell(row: readonly unknown[], column: number | undefined): string {
  return column == null ? '' : cellString(row[column]).trim();
}

export interface DetectedHeader {
  headerIndex: number;
  columns: ColumnMap;
}

export function detectColumns(rows: readonly (readonly unknown[])[]): DetectedHeader {
  const columns: ColumnMap = {};

  for (let index = 0; index < Math.min(rows.length, 12); index += 1) {
    const row = (rows[index] || []).map(cellString);
    if (!row.some((cell) => cell.includes('출발')) || !row.some((cell) => cell.includes('도착'))) {
      continue;
    }

    row.forEach((cell, columnIndex) => {
      if (cell.includes('국제선') || cell.includes('국내선')) columns.type = columnIndex;
      else if (cell.includes('출발') && cell.includes('국가')) columns.fc = columnIndex;
      else if (cell.includes('출발') && cell.includes('도시')) columns.fcity = columnIndex;
      else if (cell.includes('출발') && cell.includes('공항')) columns.fa = columnIndex;
      else if (cell.includes('출발') && (cell.includes('시각') || cell.includes('일'))) {
        columns.fd ??= columnIndex;
      } else if (cell.includes('도착') && cell.includes('국가')) columns.tc = columnIndex;
      else if (cell.includes('도착') && cell.includes('도시')) columns.tcity = columnIndex;
      else if (cell.includes('도착') && cell.includes('공항')) columns.ta = columnIndex;
      else if (cell.includes('항공사') && cell.includes('국적')) columns.nat = columnIndex;
      else if (cell.includes('항공사')) columns.al = columnIndex;
      else if (cell.includes('편명')) columns.fn = columnIndex;
      else if (cell.includes('기종')) columns.ac = columnIndex;
    });

    return { headerIndex: index, columns };
  }

  return { headerIndex: -1, columns };
}

export function determineFlightType(
  typeCell: string,
  fromCountry: string,
  toCountry: string,
): FlightType {
  if (typeCell.includes('국내')) return '국내선';
  if (typeCell.includes('국제')) return '국제선';
  return fromCountry && toCountry && fromCountry === toCountry ? '국내선' : '국제선';
}

function flightTypeSource(
  typeCell: string,
  fromCountry: string,
  toCountry: string,
): NonNullable<Flight['typeSource']> {
  if (typeCell.includes('국내') || typeCell.includes('국제')) return 'explicit';
  return fromCountry && toCountry ? 'countries' : 'fallback';
}

export function normalizeAircraft(raw: string): string {
  return raw.split(/\s+or\s+|,/i)[0].trim();
}

/** Convert worksheet-like rows using the reference implementation's header rules. */
export function parseRows(rows: readonly (readonly unknown[])[]): ParseResult {
  const { headerIndex, columns } = detectColumns(rows);
  const fromAirportColumn = columns.fa;
  const toAirportColumn = columns.ta;

  if (headerIndex < 0 || fromAirportColumn == null || toAirportColumn == null) {
    return { flights: [], err: HEADER_ERROR };
  }

  const flights: Flight[] = [];

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const fromAirport = parseIata(row[fromAirportColumn]);
    const toAirport = parseIata(row[toAirportColumn]);

    if (!fromAirport || !toAirport) {
      continue;
    }

    const dateInfo = parseDateInfo(trimmedCell(row, columns.fd));
    const typeCell = trimmedCell(row, columns.type);
    const fromCountry = trimmedCell(row, columns.fc);
    const toCountry = trimmedCell(row, columns.tc);
    const rawAircraft = trimmedCell(row, columns.ac);

    flights.push({
      id: flights.length,
      type: determineFlightType(typeCell, fromCountry, toCountry),
      typeSource: flightTypeSource(typeCell, fromCountry, toCountry),
      fc: fromCountry,
      tc: toCountry,
      fcity: trimmedCell(row, columns.fcity),
      tcity: trimmedCell(row, columns.tcity),
      fa: fromAirport,
      ta: toAirport,
      al: trimmedCell(row, columns.al),
      nat: trimmedCell(row, columns.nat),
      fn: trimmedCell(row, columns.fn),
      ac: normalizeAircraft(rawAircraft),
      d: dateInfo.d,
      y: dateInfo.y,
      sortKey: dateInfo.sortKey,
    });
  }

  return {
    flights,
    err: flights.length ? null : DATA_ERROR,
  };
}

/** Parse the first worksheet with the reference implementation's header rules. */
export function parseWorkbook(workbook: XLSX.WorkBook): ParseResult {
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;

  if (!worksheet) {
    return { flights: [], err: HEADER_ERROR };
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: false,
    defval: '',
  });
  return parseRows(rows);
}
