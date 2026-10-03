import * as XLSX from 'xlsx';
import type { Flight, FlightType, ImportRowDiagnostic, ParseResult } from '../types';
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

// Limit worksheet expansion, including sparse sheets with enormous declared ranges.
export const MAX_IMPORT_RECORDS = 20_000;
export const MAX_IMPORT_WORKSHEET_ROWS = MAX_IMPORT_RECORDS + 12;
const MAX_IMPORT_COLUMNS = 256;
const MAX_IMPORT_CELLS = 1_000_000;

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
  for (let index = 0; index < Math.min(rows.length, 12); index += 1) {
    const columns: ColumnMap = {};
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

    if (columns.fa != null && columns.ta != null) return { headerIndex: index, columns };
  }

  return { headerIndex: -1, columns: {} };
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
export function parseRows(rows: readonly (readonly unknown[])[], sourceRowOffset = 0): ParseResult {
  if (rows.length > MAX_IMPORT_WORKSHEET_ROWS) {
    throw new Error('한 번에 최대 20,000개 기록을 가져올 수 있습니다. 파일을 나눠서 선택해 주세요.');
  }
  const { headerIndex, columns } = detectColumns(rows);
  const fromAirportColumn = columns.fa;
  const toAirportColumn = columns.ta;

  if (headerIndex < 0 || fromAirportColumn == null || toAirportColumn == null) {
    return { flights: [], err: HEADER_ERROR };
  }

  const flights: Flight[] = [];
  const diagnostics: ImportRowDiagnostic[] = [];
  let dataRowCount = 0;

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    if (!row.some((cell) => cellString(cell).trim())) continue;
    dataRowCount += 1;
    if (dataRowCount > MAX_IMPORT_RECORDS) {
      throw new Error('한 번에 최대 20,000개 기록을 가져올 수 있습니다. 파일을 나눠서 선택해 주세요.');
    }
    const sourceRow = sourceRowOffset + index + 1;
    const fromAirport = parseIata(row[fromAirportColumn]);
    const toAirport = parseIata(row[toAirportColumn]);

    if (!fromAirport || !toAirport) {
      diagnostics.push({ row: sourceRow, message: '출발·도착 공항에 유효한 IATA 코드가 필요합니다.' });
      continue;
    }

    const dateInfo = parseDateInfo(trimmedCell(row, columns.fd));
    const typeCell = trimmedCell(row, columns.type);
    const fromCountry = trimmedCell(row, columns.fc);
    const toCountry = trimmedCell(row, columns.tc);
    const rawAircraft = trimmedCell(row, columns.ac);

    flights.push({
      id: flights.length,
      sourceRow,
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
      ...(dateInfo.departureTime
        ? { departureTime: dateInfo.departureTime }
        : {}),
      sortKey: dateInfo.sortKey,
    });
  }

  return {
    flights,
    err: flights.length ? null : DATA_ERROR,
    dataRowCount,
    diagnostics,
  };
}

/** Parse the first worksheet with the reference implementation's header rules. */
export function parseWorkbook(workbook: XLSX.WorkBook): ParseResult {
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;

  if (!worksheet) {
    return { flights: [], err: HEADER_ERROR };
  }

  const declaredRange = worksheet['!fullref'] || worksheet['!ref'];
  if (declaredRange) {
    const range = XLSX.utils.decode_range(declaredRange);
    const height = range.e.r - range.s.r + 1;
    const width = range.e.c - range.s.c + 1;
    if (range.e.r + 1 > MAX_IMPORT_WORKSHEET_ROWS || width > MAX_IMPORT_COLUMNS || height * width > MAX_IMPORT_CELLS) {
      throw new Error('시트가 너무 큽니다. 20,000개 이하의 기록과 필요한 열만 남기거나 파일을 나눠 주세요.');
    }
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: false,
    defval: '',
  });
  const { columns, headerIndex } = detectColumns(rows);
  if (columns.fd != null && worksheet['!ref']) {
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: range.s.r + index, c: range.s.c + columns.fd })];
      if (cell?.t !== 'n' || typeof cell.v !== 'number' || !cell.z || !XLSX.SSF.is_date(cell.z)) continue;
      // Decode spreadsheet calendar fields directly; JS Date would apply the host timezone.
      const date = XLSX.SSF.parse_date_code(cell.v, { date1904: Boolean(workbook.Workbook?.WBProps?.date1904) });
      if (!date) continue;
      const pad = (value: number) => String(value).padStart(2, '0');
      const hasTime = date.H !== 0 || date.M !== 0 || date.S !== 0
        || /h|s|am\/pm/i.test(cell.z.replace(/"[^"]*"|\\./g, ''));
      rows[index][columns.fd] = `${date.y}.${pad(date.m)}.${pad(date.d)}${hasTime ? ` ${pad(date.H)}:${pad(date.M)}` : ''}`;
    }
  }
  return parseRows(rows, worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']).s.r : 0);
}
