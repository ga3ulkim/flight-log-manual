import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { decodeCsvBytes, flightFileKind, parseFlightFile } from './fileParser';
import {
  detectColumns,
  determineFlightType,
  normalizeAircraft,
  MAX_IMPORT_WORKSHEET_ROWS,
  MAX_IMPORT_RECORDS,
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
  it('accepts the record limit and rejects one extra row without truncation', () => {
    const rows = [HEADER, ...Array.from({ length: MAX_IMPORT_RECORDS }, () => ROW)];
    expect(parseRows(rows).flights).toHaveLength(MAX_IMPORT_RECORDS);
    expect(() => parseRows([...rows, ROW])).toThrow('최대 20,000개');
  });

  it('rejects oversized sparse or truncated worksheet ranges before expanding cells', () => {
    for (const range of ['A1:XFD1048576', 'A1:A20013', 'A1:IW2', 'A1:AX20012']) {
      const sheet = XLSX.utils.aoa_to_sheet([HEADER, ROW]);
      sheet['!fullref'] = range;
      expect(() => parseWorkbook({ SheetNames: ['Flights'], Sheets: { Flights: sheet } })).toThrow('시트가 너무 큽니다');
    }
  });

  it('rejects a CSV beyond the row limit instead of importing a truncated prefix', async () => {
    const csv = ['출발 공항,도착 공항,출발 일', ...Array.from({ length: MAX_IMPORT_WORKSHEET_ROWS }, () => 'ICN,NRT,2026.08.19')].join('\n');
    await expect(parseFlightFile(new File([csv], 'oversized.csv'))).rejects.toThrow('시트가 너무 큽니다');
  });

  it('reports omitted rows and retains source positions across empty rows', () => {
    const result = parseRows([HEADER, ROW, [], ['invalid'], ROW], 3);
    expect(result.dataRowCount).toBe(3);
    expect(result.flights.map((flight) => flight.sourceRow)).toEqual([5, 8]);
    expect(result.diagnostics).toEqual([{ row: 7, message: expect.stringContaining('IATA') }]);
  });

  it('continues past a title mentioning departure and arrival', () => {
    expect(parseRows([['출발·도착 비행 기록'], HEADER, ROW]).flights).toHaveLength(1);
  });

  it.each(['xlsx', 'xls'] as const)('reads real %s date cells independently of display format', async (bookType) => {
    const serial = (Date.UTC(2026, 7, 19) - Date.UTC(1899, 11, 30)) / 86_400_000;
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['출발 공항', '도착 공항', '출발 일'],
      ['ICN', 'NRT', serial + 14.5 / 24],
      ['NRT', 'ICN', serial],
    ]);
    worksheet.C2.z = 'm/d/yy h:mm';
    worksheet.C3.z = 'm/d/yy';
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Flights');
    const bytes = XLSX.write(workbook, { type: 'array', bookType });
    const parsed = await parseFlightFile(new File([bytes], `synthetic.${bookType}`));
    expect(parsed.flights[0]).toMatchObject({ d: '2026.08.19', departureTime: '14:30' });
    expect(parsed.flights[1]).toMatchObject({ d: '2026.08.19' });
    expect(parsed.flights[1].departureTime).toBeUndefined();
  });

  it('respects the 1904 workbook date system and explicit midnight', () => {
    const serial = (Date.UTC(2026, 7, 19) - Date.UTC(1904, 0, 1)) / 86_400_000;
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['출발 공항', '도착 공항', '출발 일'], ['ICN', 'NRT', serial],
    ]);
    worksheet.C2.z = 'yyyy/mm/dd hh:mm';
    const workbook = XLSX.utils.book_new();
    workbook.Workbook = { WBProps: { date1904: true } };
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Flights');
    expect(parseWorkbook(workbook).flights[0]).toMatchObject({
      d: '2026.08.19', departureTime: '00:00',
    });
  });

  it('preserves slash dates and leading zero text when reading CSV', async () => {
    const csv = '출발 공항,도착 공항,출발 일,편명\nICN,NRT,2026/08/19 14:30,0012';
    const parsed = await parseFlightFile(new File([csv], 'synthetic.csv'));
    expect(parsed.flights[0]).toMatchObject({ d: '2026.08.19', departureTime: '14:30', fn: '0012' });
  });

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
