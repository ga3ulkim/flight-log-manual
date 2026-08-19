import { describe, expect, it } from 'vitest';
import {
  AP,
  mergeAirportCoordinates,
  resolveAirportCoordinate,
} from './airports';
import {
  GENERATED_AIRPORT_COORDINATES,
  GENERATED_AIRPORT_COUNT,
} from './generated/ourAirports';

describe('local airport lookup', () => {
  it('ships a comprehensive generated IATA index', () => {
    expect(GENERATED_AIRPORT_COUNT).toBeGreaterThan(8_000);
    expect(Object.keys(GENERATED_AIRPORT_COORDINATES)).toHaveLength(
      GENERATED_AIRPORT_COUNT,
    );
  });

  it('resolves representative airports retained from the validated table', () => {
    expect(AP.ICN).toEqual(expect.arrayContaining([expect.any(Number), expect.any(Number)]));
    expect(AP.LHR).toEqual(expect.arrayContaining([expect.any(Number), expect.any(Number)]));
    expect(AP.SYD).toEqual(expect.arrayContaining([expect.any(Number), expect.any(Number)]));
  });

  it('resolves BLL, which was not in the former manual table', () => {
    expect(AP.BLL).toEqual(expect.arrayContaining([expect.any(Number), expect.any(Number)]));
  });

  it('gives a manual correction precedence over generated data', () => {
    const generated = { TST: [1, 2] } as const;
    const overrides = { TST: [3, 4] } as const;
    expect(resolveAirportCoordinate('TST', generated, overrides)).toEqual([3, 4]);
    expect(mergeAirportCoordinates(generated, overrides).TST).toEqual([3, 4]);
  });

  it('retains the reviewed historical REP override', () => {
    expect(AP.REP).toEqual([13.41, 103.81]);
  });

  it('returns undefined for an unknown IATA code', () => {
    expect(resolveAirportCoordinate('ZZZ')).toBeUndefined();
    expect(AP.ZZZ).toBeUndefined();
  });
});
