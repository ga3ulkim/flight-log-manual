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
  const numericDateMatch = value.match(/(19|20)\d{2}[.-](\d{1,2})[.-](\d{1,2})/);
  const month = KoreanMonthMatch
    ? Number(KoreanMonthMatch[1])
    : numericDateMatch
      ? Number(numericDateMatch[2])
      : null;
  const day = KoreanDayMatch
    ? Number(KoreanDayMatch[1])
    : numericDateMatch
      ? Number(numericDateMatch[3])
      : null;
  const paddedMonth = month == null ? null : String(month).padStart(2, '0');
  const paddedDay = day == null ? null : String(day).padStart(2, '0');
  const displayDate = paddedMonth
    ? paddedDay
      ? `${year}.${paddedMonth}.${paddedDay}`
      : `${year}.${paddedMonth}`
    : String(year);
  const timeMatch = paddedMonth && paddedDay
    ? value.match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?=$|\s)/)
    : null;
  const departureTime = timeMatch
    ? `${String(Number(timeMatch[1])).padStart(2, '0')}:${timeMatch[2]}`
    : undefined;
  const dateSortKey = `${year}.${paddedMonth || '00'}.${paddedDay || '00'}`;

  return {
    y: year,
    d: displayDate,
    ...(departureTime ? { departureTime } : {}),
    sortKey: departureTime ? `${dateSortKey} ${departureTime}` : dateSortKey,
  };
}

/** Find the first standalone three-letter IATA code in a cell value. */
export function parseIata(raw: unknown): IataCode | null {
  const match = String(raw || '').toUpperCase().match(/\b[A-Z]{3}\b/);
  return match ? match[0] : null;
}
