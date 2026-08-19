/** Compact tuple emitted by the OurAirports build-time updater. */
export type AirportSearchTuple = readonly [
  iata: string,
  name: string,
  municipality: string,
  countryCode: string,
];

export interface AirportSearchEntry {
  readonly iata: string;
  readonly name: string;
  readonly municipality: string;
  readonly countryCode: string;
  /** Localized when Intl.DisplayNames is available; otherwise the ISO code. */
  readonly countryName: string;
}

export interface AirportSearchCatalog {
  readonly size: number;
  search(query: string, limit?: number): readonly AirportSearchEntry[];
  findByIata(iata: string): AirportSearchEntry | undefined;
}

export interface AirportSearchCatalogOptions {
  /** The first locale supplies countryName; every locale is searchable. */
  readonly countryLocales?: readonly string[];
  readonly resolveCountryName?: (
    countryCode: string,
    locale: string,
  ) => string | undefined;
}

export const DEFAULT_AIRPORT_SEARCH_LIMIT = 8;
export const MAX_AIRPORT_SEARCH_LIMIT = 50;

const DEFAULT_COUNTRY_LOCALES = Object.freeze(['ko', 'en']);

type RegionDisplayNames = {
  of(countryCode: string): string | undefined;
};

type RegionDisplayNamesConstructor = new (
  locales: string | readonly string[],
  options: { type: 'region' },
) => RegionDisplayNames;

interface PreparedAirport {
  readonly entry: AirportSearchEntry;
  readonly iata: string;
  readonly name: string;
  readonly municipality: string;
  readonly countryAliases: readonly string[];
  readonly countryText: string;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function createIntlCountryResolver(): AirportSearchCatalogOptions['resolveCountryName'] {
  const displayNamesConstructor = (
    Intl as typeof Intl & { DisplayNames?: RegionDisplayNamesConstructor }
  ).DisplayNames;
  if (!displayNamesConstructor) return undefined;

  const displaysByLocale = new Map<string, RegionDisplayNames | null>();
  return (countryCode, locale) => {
    let displayNames = displaysByLocale.get(locale);
    if (displayNames === undefined) {
      try {
        displayNames = new displayNamesConstructor(locale, { type: 'region' });
      } catch {
        displayNames = null;
      }
      displaysByLocale.set(locale, displayNames);
    }

    try {
      return displayNames?.of(countryCode);
    } catch {
      return undefined;
    }
  };
}

function resolveLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_AIRPORT_SEARCH_LIMIT;
  if (!Number.isFinite(value)) return DEFAULT_AIRPORT_SEARCH_LIMIT;
  return Math.min(MAX_AIRPORT_SEARCH_LIMIT, Math.max(0, Math.floor(value)));
}

function isWordPrefix(value: string, query: string): boolean {
  return value.startsWith(query) || value.includes(` ${query}`);
}

function matchRank(airport: PreparedAirport, query: string): number | null {
  // The bucket ordering is intentional: a code is always more useful than a
  // textual coincidence, with exact code matches ahead of code prefixes.
  if (airport.iata === query) return 0;
  if (airport.iata.startsWith(query)) return 1;
  if (airport.name === query) return 2;
  if (isWordPrefix(airport.name, query)) return 3;
  if (airport.municipality === query) return 4;
  if (isWordPrefix(airport.municipality, query)) return 5;
  if (airport.countryAliases.includes(query)) return 6;
  if (
    airport.countryAliases.some((country) => isWordPrefix(country, query))
  ) {
    return 7;
  }
  if (airport.name.includes(query)) return 8;
  if (airport.municipality.includes(query)) return 9;
  if (airport.countryText.includes(query)) return 10;
  if (airport.iata.includes(query)) return 11;
  return null;
}

/**
 * Prepare the ~9,000-row snapshot once when the add/edit UI opens. Searches
 * then perform one allocation-bounded scan and return at most 50 rows.
 */
export function createAirportSearchCatalog(
  tuples: readonly AirportSearchTuple[],
  options: AirportSearchCatalogOptions = {},
): AirportSearchCatalog {
  const countryLocales =
    options.countryLocales?.filter(Boolean) ?? DEFAULT_COUNTRY_LOCALES;
  const resolveCountryName =
    options.resolveCountryName ?? createIntlCountryResolver();
  const countries = new Map<
    string,
    {
      readonly displayName: string;
      readonly searchable: readonly string[];
    }
  >();
  const byIata = new Map<string, AirportSearchEntry>();

  const prepared = tuples.map((tuple) => {
    const [rawIata, name, municipality, rawCountryCode] = tuple;
    const iata = rawIata.trim().toUpperCase();
    const countryCode = rawCountryCode.trim().toUpperCase();
    let country = countries.get(countryCode);
    if (!country) {
      const localizedNames = countryLocales
        .map((locale) => resolveCountryName?.(countryCode, locale)?.trim())
        .filter((value): value is string => Boolean(value));
      const displayName = localizedNames[0] ?? countryCode;
      const searchable = [...new Set([countryCode, ...localizedNames])]
        .map(normalizeSearchText)
        .filter(Boolean);
      country = Object.freeze({ displayName, searchable });
      countries.set(countryCode, country);
    }

    const entry = Object.freeze({
      iata,
      name,
      municipality,
      countryCode,
      countryName: country.displayName,
    });
    byIata.set(iata, entry);
    return {
      entry,
      iata: normalizeSearchText(iata),
      name: normalizeSearchText(name),
      municipality: normalizeSearchText(municipality),
      countryAliases: country.searchable,
      countryText: country.searchable.join(' '),
    } satisfies PreparedAirport;
  });
  prepared.sort((left, right) => left.entry.iata.localeCompare(right.entry.iata, 'en'));

  return Object.freeze({
    size: prepared.length,
    findByIata(iata: string) {
      return byIata.get(iata.trim().toUpperCase());
    },
    search(query: string, requestedLimit = DEFAULT_AIRPORT_SEARCH_LIMIT) {
      const normalizedQuery = normalizeSearchText(query);
      const limit = resolveLimit(requestedLimit);
      if (!normalizedQuery || limit === 0) return [];

      const buckets: PreparedAirport[][] = Array.from(
        { length: 12 },
        () => [],
      );
      for (const airport of prepared) {
        const rank = matchRank(airport, normalizedQuery);
        if (rank !== null) buckets[rank].push(airport);
      }

      const results: AirportSearchEntry[] = [];
      for (const bucket of buckets) {
        for (const airport of bucket) {
          results.push(airport.entry);
          if (results.length === limit) return results;
        }
      }
      return results;
    },
  });
}

const defaultCatalogs = new WeakMap<
  readonly AirportSearchTuple[],
  AirportSearchCatalog
>();

/** Pure convenience API for tests and callers that already own generated rows. */
export function searchAirports(
  tuples: readonly AirportSearchTuple[],
  query: string,
  limit = DEFAULT_AIRPORT_SEARCH_LIMIT,
): readonly AirportSearchEntry[] {
  let catalog = defaultCatalogs.get(tuples);
  if (!catalog) {
    catalog = createAirportSearchCatalog(tuples);
    defaultCatalogs.set(tuples, catalog);
  }
  return catalog.search(query, limit);
}

let generatedCatalogPromise: Promise<AirportSearchCatalog> | undefined;

/**
 * The only generated-data import is dynamic, keeping airport names and cities
 * out of the initial map/dashboard bundle until an add/edit surface needs them.
 */
export function loadAirportSearchCatalog(): Promise<AirportSearchCatalog> {
  generatedCatalogPromise ??= import('../data/generated/airportSearch').then(
    ({ GENERATED_AIRPORT_SEARCH_INDEX }) =>
      createAirportSearchCatalog(GENERATED_AIRPORT_SEARCH_INDEX),
  );
  generatedCatalogPromise.catch(() => {
    // A transient same-site chunk failure should not poison all future opens.
    generatedCatalogPromise = undefined;
  });
  return generatedCatalogPromise;
}
