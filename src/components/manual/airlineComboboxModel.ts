import type {
  AirlineSearchCatalog,
  AirlineSearchEntry,
} from '../../lib/airlineSearch';

interface CatalogOption {
  kind: 'catalog';
  entry: AirlineSearchEntry;
}

interface HistoryOption {
  kind: 'history';
  name: string;
}

export type AirlineOption = CatalogOption | HistoryOption;

export interface AirlineOptionValue {
  value: string;
  selection: {
    name: string;
    iata: string;
    icao: string;
    country?: string;
  } | null;
}

function normalized(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('en');
}

/** Keeps local catalog hits first while retaining free-text values from this session. */
export function airlineOptions(
  catalog: AirlineSearchCatalog | null,
  history: readonly string[],
  query: string,
  limit = 8,
): AirlineOption[] {
  const needle = normalized(query);
  if (!needle || limit <= 0) return [];

  const catalogResults = catalog?.search(query, limit) ?? [];
  const options: AirlineOption[] = catalogResults.map((entry) => ({
    kind: 'catalog',
    entry,
  }));
  const seen = new Set(catalogResults.map((entry) => normalized(entry.name)));

  for (const name of history) {
    const normalizedName = normalized(name);
    if (
      options.length >= limit
      || !normalizedName.includes(needle)
      || seen.has(normalizedName)
    ) continue;
    seen.add(normalizedName);
    options.push({ kind: 'history', name });
  }

  return options;
}

export function nextAirlineOptionIndex(
  current: number,
  optionCount: number,
  direction: 'next' | 'previous',
): number {
  if (optionCount <= 0) return -1;
  if (direction === 'next') return current < optionCount - 1 ? current + 1 : 0;
  return current > 0 ? current - 1 : optionCount - 1;
}

/** Catalog choices retain stable codes; history choices remain honest free text. */
export function airlineOptionValue(option: AirlineOption): AirlineOptionValue {
  if (option.kind === 'history') {
    return { value: option.name, selection: null };
  }
  return {
    value: option.entry.name,
    selection: {
      name: option.entry.name,
      iata: option.entry.iata,
      icao: option.entry.icao,
      ...(option.entry.country ? { country: option.entry.country } : {}),
    },
  };
}

/** Stable across rerenders and distinct for same-name catalog entities. */
export function airlineOptionKey(option: AirlineOption, index: number): string {
  if (option.kind === 'history') return `history-${normalized(option.name)}-${index}`;
  return `catalog-${JSON.stringify([
    option.entry.name,
    option.entry.iata,
    option.entry.icao,
    option.entry.country,
  ])}-${index}`;
}
