import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { decodeCsvBytes, flightFileKind } from './fileParser';
import {
  detectColumns,
  determineFlightType,
  normalizeAircraft,
  parseRows,
  parseWorkbook,
} from './parser';

const HEADER = [
  '메모',
  '도착 공항',
  '출발 국가',
  '항공사',
  '출발 공항',
  '도착 국가',
  '국제선/국내선',
  '출발 시각',
  '출발 도시',
  '도착 도시',
  '편명',
  '비행기 기종',
];

const ROW = [
  'synthetic fixture',
  'Beta Airport (NRT)',
  'Synthetic Republic A',
  'Example Airways',
  'Alpha Airport (ICN)',
  'Synthetic Republic B',
  '국제선',
  '2099.4.5 10:00',
  'Alpha City',
  'Beta City',
  'EX 200',
  'A320 or A321',
];

describe('workbook header detection', () => {
  it('finds a reordered header within the first twelve rows', () => {
    const rows = [...Array.from({ length: 11 }, () => ['synthetic note']), HEADER];
    const detected = detectColumns(rows);

    expect(detected.headerIndex).toBe(11);
    expect(detected.columns).toMatchObject({
      ta: 1,
      fc: 2,
      al: 3,
      fa: 4,
      tc: 5,
      type: 6,
      fd: 7,
      fcity: 8,
      tcity: 9,
      fn: 10,
      ac: 11,
    });
  });

  it('does not scan beyond the reference twelve-row limit', () => {
    const rows = [...Array.from({ length: 12 }, () => ['synthetic note']), HEADER, ROW];
    expect(detectColumns(rows).headerIndex).toBe(-1);
  });

  it('parses a synthetic CSV workbook with labeled IATA cells', () => {
    const csv = [HEADER, ROW]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');
    const result = parseWorkbook(XLSX.read(csv, { type: 'string' }));

    expect(result.err).toBeNull();
    expect(result.flights).toHaveLength(1);
    expect(result.flights[0]).toMatchObject({
      fa: 'ICN',
      ta: 'NRT',
      type: '국제선',
      typeSource: 'explicit',
      d: '2099.04.05',
      ac: 'A320',
    });
  });

  it('parses the first worksheet of a synthetic XLSX-style workbook', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['synthetic title'], HEADER, ROW]),
      'Flights',
    );

    const result = parseWorkbook(workbook);
    expect(result.err).toBeNull();
    expect(result.flights[0]).toMatchObject({ fn: 'EX 200', al: 'Example Airways' });
  });

  it('returns a useful error when required airport headers are absent', () => {
    const result = parseRows([['출발 도시', '도착 도시'], ['Alpha', 'Beta']]);
    expect(result.flights).toEqual([]);
    expect(result.err).toContain('헤더');
  });
});

describe('local file format detection', () => {
  it('accepts CSV, XLS, and XLSX names without depending on letter case', () => {
    expect(flightFileKind({ name: 'synthetic.CSV', type: '' })).toBe('csv');
    expect(flightFileKind({ name: 'synthetic.xls', type: '' })).toBe('workbook');
    expect(flightFileKind({ name: 'synthetic.XLSX', type: '' })).toBe('workbook');
  });

  it('rejects unsupported files before parsing', () => {
    expect(flightFileKind({ name: 'synthetic.txt', type: 'text/plain' })).toBeNull();
  });
});

describe('flight row normalization', () => {
  it('honors an explicit route type before country inference', () => {
    expect(determineFlightType('국내선', 'A', 'B')).toBe('국내선');
    expect(determineFlightType('국제선', 'A', 'A')).toBe('국제선');
  });

  it('infers domestic only when both non-empty countries match', () => {
    expect(determineFlightType('', 'Synthetic A', 'Synthetic A')).toBe('국내선');
    expect(determineFlightType('', 'Synthetic A', 'Synthetic B')).toBe('국제선');
    expect(determineFlightType('', '', '')).toBe('국제선');
  });

  it('marks a missing type and country pair as an unsafe fallback for import', () => {
    const header = ['출발 공항', '도착 공항', '출발 일'];
    const result = parseRows([header, ['ZZZ', 'YYY', '2025.01.21']]);
    expect(result.flights[0]).toMatchObject({
      type: '국제선',
      typeSource: 'fallback',
    });
  });

  it('keeps only the first aircraft alternative', () => {
    expect(normalizeAircraft('B787-9, A350-900')).toBe('B787-9');
    expect(normalizeAircraft('A320 or A321')).toBe('A320');
  });

  it('skips rows without two valid IATA codes', () => {
    const invalid = [...ROW];
    invalid[1] = 'No airport code';
    const result = parseRows([HEADER, invalid, ROW]);
    expect(result.flights).toHaveLength(1);
    expect(result.flights[0].id).toBe(0);
  });

  it('decodes a synthetic UTF-8 CSV byte buffer', () => {
    const text = '출발 공항,도착 공항\nICN,NRT';
    expect(decodeCsvBytes(new TextEncoder().encode(text))).toBe(text);
  });
});
