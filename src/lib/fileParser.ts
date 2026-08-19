import * as XLSX from 'xlsx';
import type { ParseResult } from '../types';
import { parseWorkbook } from './parser';

export type FlightFileKind = 'csv' | 'workbook';

const CSV_MIME_TYPES = new Set(['text/csv', 'application/csv']);
const WORKBOOK_MIME_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/** Identify only the three file formats exposed by the upload experience. */
export function flightFileKind(file: Pick<File, 'name' | 'type'>): FlightFileKind | null {
  if (/\.csv$/i.test(file.name) || CSV_MIME_TYPES.has(file.type)) return 'csv';
  if (/\.xls(x)?$/i.test(file.name) || WORKBOOK_MIME_TYPES.has(file.type)) {
    return 'workbook';
  }
  return null;
}

/** Prefer strict UTF-8, then the browser's Korean/CP949 decoder, as before. */
export function decodeCsvBytes(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('euc-kr').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

/** Read one local browser file without sending its bytes anywhere. */
export async function parseFlightFile(file: File): Promise<ParseResult> {
  const kind = flightFileKind(file);
  if (!kind) {
    throw new Error('지원하지 않는 파일 형식이에요. CSV, XLS, XLSX 파일을 선택해 주세요.');
  }

  const buffer = await file.arrayBuffer();
  const workbook = kind === 'csv'
    ? XLSX.read(decodeCsvBytes(buffer), { type: 'string' })
    : XLSX.read(buffer, { type: 'array' });

  return parseWorkbook(workbook);
}
