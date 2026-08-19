import type { Flight } from './types';

/** Synthetic-only factory for unit tests; no values originate from personal flight data. */
export function makeFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: 0,
    type: '국제선',
    fc: 'Synthetic Republic A',
    tc: 'Synthetic Republic B',
    fcity: 'Alpha City',
    tcity: 'Beta City',
    fa: 'ICN',
    ta: 'NRT',
    al: 'Example Airways',
    nat: 'Synthetic Republic A',
    fn: 'EX 100',
    ac: 'A320',
    d: '2099.01.01',
    y: 2099,
    sortKey: '2099.01.01',
    ...overrides,
  };
}
