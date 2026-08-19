import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  AirlineSearchCatalog,
  AirlineSearchEntry,
} from '../../lib/airlineSearch';
import { createAirlineSearchCatalog } from '../../lib/airlineSearch';
import AirlineCombobox from './AirlineCombobox';
import {
  airlineOptionKey,
  airlineOptionValue,
  airlineOptions,
  nextAirlineOptionIndex,
} from './airlineComboboxModel';

const entries: readonly AirlineSearchEntry[] = [
  {
    name: 'Korean Air',
    iata: 'KE',
    icao: 'KAL',
    country: '대한민국',
  },
  {
    name: 'Example Airways',
    iata: 'EX',
    icao: 'EXP',
    country: 'Synthetic Republic',
  },
];

const catalog: AirlineSearchCatalog = {
  size: entries.length,
  search: (query, limit = 8) => {
    const needle = query.toLocaleLowerCase('en');
    return entries
      .filter((entry) => [entry.name, entry.iata, entry.icao, entry.country]
        .some((value) => value.toLocaleLowerCase('en').includes(needle)))
      .slice(0, limit);
  },
  findByCanonicalName: (name) => entries.find((entry) => entry.name === name),
  findBySnapshot: (snapshot) => entries.find((entry) =>
    entry.name === snapshot.name
    && (!snapshot.iata || entry.iata === snapshot.iata)
    && (!snapshot.icao || entry.icao === snapshot.icao)
    && (!snapshot.country || entry.country === snapshot.country)),
};

describe('AirlineCombobox', () => {
  it('prioritizes catalog matches, deduplicates history, and keeps free-text history', () => {
    expect(airlineOptions(
      catalog,
      ['Korean Air', 'Korea Wings', 'Unrelated Air'],
      'Korea',
    )).toEqual([
      { kind: 'catalog', entry: entries[0] },
      { kind: 'history', name: 'Korea Wings' },
    ]);
  });

  it('wraps keyboard navigation in both directions', () => {
    expect(nextAirlineOptionIndex(-1, 3, 'next')).toBe(0);
    expect(nextAirlineOptionIndex(2, 3, 'next')).toBe(0);
    expect(nextAirlineOptionIndex(-1, 3, 'previous')).toBe(2);
    expect(nextAirlineOptionIndex(0, 3, 'previous')).toBe(2);
    expect(nextAirlineOptionIndex(0, 0, 'next')).toBe(-1);
  });

  it('stores codes only for a selected catalog result, never for free text', () => {
    expect(airlineOptionValue({ kind: 'catalog', entry: entries[0] })).toEqual({
      value: 'Korean Air',
      selection: {
        name: 'Korean Air',
        iata: 'KE',
        icao: 'KAL',
        country: '대한민국',
      },
    });
    expect(airlineOptionValue({ kind: 'history', name: 'My Own Airline' })).toEqual({
      value: 'My Own Airline',
      selection: null,
    });
  });

  it('gives same-name catalog options distinct stable keys', () => {
    const north = {
      kind: 'catalog' as const,
      entry: { name: 'Twin Air', iata: '', icao: '', country: 'Northland' },
    };
    const south = {
      kind: 'catalog' as const,
      entry: { name: 'Twin Air', iata: 'T2', icao: 'TWN', country: 'Southland' },
    };
    expect(airlineOptionKey(north, 0)).not.toBe(airlineOptionKey(south, 1));
    expect(airlineOptionKey(north, 0)).toBe(airlineOptionKey({
      kind: 'catalog',
      entry: { ...north.entry },
    }, 0));
    expect(airlineOptionKey(north, 0)).not.toBe(airlineOptionKey(north, 1));
  });

  it('exposes combobox semantics and selected local metadata', () => {
    const markup = renderToStaticMarkup(
      <AirlineCombobox
        value="Korean Air"
        selection={{
          name: 'Korean Air',
          iata: 'KE',
          icao: 'KAL',
          country: '대한민국',
        }}
        catalog={catalog}
        catalogLoading={false}
        catalogError=""
        history={[]}
        disabled={false}
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-autocomplete="list"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('value="Korean Air"');
    expect(markup).toContain('IATA KE · ICAO KAL · 대한민국');
    expect(markup).toContain('aria-label="선택한 항공사 변경"');
  });

  it('rehydrates duplicate canonical names from saved codes or country', () => {
    const duplicateCatalog = createAirlineSearchCatalog([
      ['Twin Air', [], [], 'Northland', []],
      ['Twin Air', ['T2'], ['TWN'], 'Southland', []],
    ]);
    const codedMarkup = renderToStaticMarkup(
      <AirlineCombobox
        value="Twin Air"
        selection={{ name: 'Twin Air', iata: 'T2', icao: 'TWN' }}
        catalog={duplicateCatalog}
        catalogLoading={false}
        catalogError=""
        history={[]}
        disabled={false}
        onChange={() => undefined}
      />,
    );
    expect(codedMarkup).toContain('IATA T2 · ICAO TWN · Southland');

    const countryMarkup = renderToStaticMarkup(
      <AirlineCombobox
        value="Twin Air"
        selection={{ name: 'Twin Air', iata: '', icao: '', country: 'Northland' }}
        catalog={duplicateCatalog}
        catalogLoading={false}
        catalogError=""
        history={[]}
        disabled={false}
        onChange={() => undefined}
      />,
    );
    expect(countryMarkup).toContain('<span>Northland</span>');
  });

  it('keeps direct entry available when the local catalog fails', () => {
    const markup = renderToStaticMarkup(
      <AirlineCombobox
        value="My Own Airline"
        selection={null}
        catalog={null}
        catalogLoading={false}
        catalogError="항공사 검색 목록을 불러오지 못했습니다."
        history={[]}
        disabled={false}
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain('value="My Own Airline"');
    expect(markup).toContain('직접 입력은 계속 사용할 수 있습니다.');
    expect(markup).not.toContain('IATA My');
  });
});
