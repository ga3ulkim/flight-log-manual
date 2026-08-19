import type { AirportSearchAlias } from './airportSearch';

/**
 * Small, hand-reviewed Korean search overlay.
 *
 * This is deliberately separate from the generated OurAirports snapshot so a
 * monthly regeneration cannot overwrite editorial aliases. Add entries only
 * after reviewing the Korean term and its airport ordering. The IATA order is
 * the result order for an exact alias match.
 */
export const REVIEWED_KOREAN_AIRPORT_ALIASES = [
  { alias: '인천', iatas: ['ICN'] },
  { alias: '인천공항', iatas: ['ICN'] },
  { alias: '인천국제공항', iatas: ['ICN'] },
  { alias: '서울', iatas: ['ICN', 'GMP'] },
  { alias: '김포', iatas: ['GMP'] },
  { alias: '김포공항', iatas: ['GMP'] },
  { alias: '부산', iatas: ['PUS'] },
  { alias: '김해', iatas: ['PUS'] },
  { alias: '김해공항', iatas: ['PUS'] },
  { alias: '제주', iatas: ['CJU'] },
  { alias: '제주공항', iatas: ['CJU'] },
  { alias: '로스앤젤레스', iatas: ['LAX'] },
  { alias: '도쿄', iatas: ['HND', 'NRT'] },
  { alias: '하네다', iatas: ['HND'] },
  { alias: '나리타', iatas: ['NRT'] },
  { alias: '오사카', iatas: ['KIX', 'ITM'] },
  { alias: '간사이', iatas: ['KIX'] },
  { alias: '이타미', iatas: ['ITM'] },
] as const satisfies readonly AirportSearchAlias[];
