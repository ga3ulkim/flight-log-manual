import type { DateInfo, IataCode } from '../types';

/** Extract the same partial-date precision used by the reference implementation. */
export function parseDateInfo(raw: unknown): DateInfo {
  const value = String(raw || '');
  const yearMatch = value.match(/(19|20)\d{2}/);

  if (!yearMatch) {
    return { y: null, d: '', sortKey: '9999.99.99' };
  }

  const year = Number(yearMatch[0]);
  const KoreanMonthMatch = value.match(/(\d{1,2})\s*월/);
  const KoreanDayMatch = value.match(/(\d{1,2})\s*일/);
  const dottedDateMatch = value.match(/(19|20)\d{2}\.(\d{1,2})\.(\d{1,2})/);
  const month = KoreanMonthMatch
    ? Number(KoreanMonthMatch[1])
    : dottedDateMatch
      ? Number(dottedDateMatch[2])
      : null;
  const day = KoreanDayMatch
    ? Number(KoreanDayMatch[1])
    : dottedDateMatch
      ? Number(dottedDateMatch[3])
      : null;
  const paddedMonth = month == null ? null : String(month).padStart(2, '0');
  const paddedDay = day == null ? null : String(day).padStart(2, '0');
  const displayDate = paddedMonth
    ? paddedDay
      ? `${year}.${paddedMonth}.${paddedDay}`
      : `${year}.${paddedMonth}`
    : String(year);

  return {
    y: year,
    d: displayDate,
    sortKey: `${year}.${paddedMonth || '00'}.${paddedDay || '00'}`,
  };
}

/** Find the first standalone three-letter IATA code in a cell value. */
export function parseIata(raw: unknown): IataCode | null {
  const match = String(raw || '').toUpperCase().match(/\b[A-Z]{3}\b/);
  return match ? match[0] : null;
}
