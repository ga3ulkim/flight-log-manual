/** Compact tuple emitted by the OurAirports build-time updater. */
export type AirportSearchTuple = readonly [
  iata: string,
  name: string,
  municipality: string,
  countryCode: string,
  /** Generated IANA timezone; optional only for legacy/synthetic fixtures. */
  timezoneId?: string,
];

export interface AirportSearchEntry {
  readonly iata: string;
  readonly name: string;
  readonly municipality: string;
  readonly countryCode: string;
  /** Localized when Intl.DisplayNames is available; otherwise the ISO code. */
  readonly countryName: string;
  readonly timezoneId?: string;
}

export interface AirportSearchCatalog {
  readonly size: number;
  search(query: string, limit?: number): readonly AirportSearchEntry[];
  findByIata(iata: string): AirportSearchEntry | undefined;
}

export interface AirportSearchAlias {
  readonly alias: string;
  /** Ordering is editorial and is preserved for an exact alias match. */
  readonly iatas: readonly string[];
}

export interface AirportSearchCatalogOptions {
  /** The first locale supplies countryName; every locale is searchable. */
  readonly countryLocales?: readonly string[];
  readonly resolveCountryName?: (
    countryCode: string,
    locale: string,
  ) => string | undefined;
  /** Optional, explicitly reviewed aliases kept outside generated data. */
  readonly aliases?: readonly AirportSearchAlias[];
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
  readonly aliases: readonly PreparedAlias[];
}

interface PreparedAlias {
  readonly text: string;
  readonly aliasOrder: number;
  readonly iataOrder: number;
}

interface AirportMatch {
  readonly rank: number;
  readonly orderGroup: number;
  readonly aliasOrder: number;
  readonly iataOrder: number;
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

function firstMatchingAlias(
  aliases: readonly PreparedAlias[],
  predicate: (alias: string) => boolean,
): PreparedAlias | undefined {
  let best: PreparedAlias | undefined;
  for (const alias of aliases) {
    if (!predicate(alias.text)) continue;
    if (
      !best
      || alias.aliasOrder < best.aliasOrder
      || (
        alias.aliasOrder === best.aliasOrder
        && alias.iataOrder < best.iataOrder
      )
    ) {
      best = alias;
    }
  }
  return best;
}

function aliasMatch(rank: number, alias: PreparedAlias): AirportMatch {
  return {
    rank,
    orderGroup: 0,
    aliasOrder: alias.aliasOrder,
    iataOrder: alias.iataOrder,
  };
}

function canonicalMatch(rank: number): AirportMatch {
  return {
    rank,
    orderGroup: 0,
    aliasOrder: 0,
    iataOrder: 0,
  };
}

function matchRank(airport: PreparedAirport, query: string): AirportMatch | null {
  // Bucket ordering is intentional and public-facing: exact IATA, exact
  // reviewed alias, prefixes, canonical matches, then substring matches.
  if (airport.iata === query) return canonicalMatch(0);

  const exactAlias = firstMatchingAlias(
    airport.aliases,
    (alias) => alias === query,
  );
  if (exactAlias) return aliasMatch(1, exactAlias);

  if (airport.iata.startsWith(query)) return canonicalMatch(2);
  const prefixAlias = firstMatchingAlias(
    airport.aliases,
    (alias) => isWordPrefix(alias, query),
  );
  if (prefixAlias) {
    return {
      ...aliasMatch(2, prefixAlias),
      // Preserve IATA-prefix precedence within the shared prefix bucket.
      orderGroup: 1,
    };
  }

  if (airport.name === query) return canonicalMatch(3);
  if (isWordPrefix(airport.name, query)) return canonicalMatch(4);
  if (airport.municipality === query) return canonicalMatch(5);
  if (isWordPrefix(airport.municipality, query)) return canonicalMatch(6);
  if (airport.countryAliases.includes(query)) return canonicalMatch(7);
  if (
    airport.countryAliases.some((country) => isWordPrefix(country, query))
  ) {
    return canonicalMatch(8);
  }

  const substringAlias = firstMatchingAlias(
    airport.aliases,
    (alias) => alias.includes(query),
  );
  if (substringAlias) return aliasMatch(9, substringAlias);
  if (airport.name.includes(query)) return canonicalMatch(10);
  if (airport.municipality.includes(query)) return canonicalMatch(11);
  if (airport.countryText.includes(query)) return canonicalMatch(12);
  if (airport.iata.includes(query)) return canonicalMatch(13);
  return null;
}

function compareEditorialOrder(
  left: { readonly airport: PreparedAirport; readonly match: AirportMatch },
  right: { readonly airport: PreparedAirport; readonly match: AirportMatch },
): number {
  return left.match.orderGroup - right.match.orderGroup
    || left.match.aliasOrder - right.match.aliasOrder
    || left.match.iataOrder - right.match.iataOrder
    || left.airport.entry.iata.localeCompare(right.airport.entry.iata, 'en');
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
  const aliasesByIata = new Map<string, PreparedAlias[]>();

  options.aliases?.forEach(({ alias, iatas }, aliasOrder) => {
    const text = normalizeSearchText(alias);
    if (!text) return;
    const seenIatas = new Set<string>();
    iatas.forEach((rawIata, iataOrder) => {
      const iata = rawIata.trim().toUpperCase();
      if (!iata || seenIatas.has(iata)) return;
      seenIatas.add(iata);
      const aliases = aliasesByIata.get(iata) ?? [];
      aliases.push({ text, aliasOrder, iataOrder });
      aliasesByIata.set(iata, aliases);
    });
  });

  const prepared = tuples.map((tuple) => {
    const [rawIata, name, municipality, rawCountryCode, timezoneId] = tuple;
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
      ...(timezoneId ? { timezoneId } : {}),
    });
    byIata.set(iata, entry);
    return {
      entry,
      iata: normalizeSearchText(iata),
      name: normalizeSearchText(name),
      municipality: normalizeSearchText(municipality),
      countryAliases: country.searchable,
      countryText: country.searchable.join(' '),
      aliases: aliasesByIata.get(iata) ?? [],
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

      const buckets: Array<Array<{
        readonly airport: PreparedAirport;
        readonly match: AirportMatch;
      }>> = Array.from(
        { length: 14 },
        () => [],
      );
      for (const airport of prepared) {
        const match = matchRank(airport, normalizedQuery);
        if (match !== null) buckets[match.rank].push({ airport, match });
      }

      const results: AirportSearchEntry[] = [];
      for (const [rank, bucket] of buckets.entries()) {
        // Only alias-bearing buckets need editorial ordering; canonical
        // buckets retain the pre-sorted IATA order without another sort.
        if (rank === 1 || rank === 2 || rank === 9) {
          bucket.sort(compareEditorialOrder);
        }
        for (const { airport } of bucket) {
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
  generatedCatalogPromise ??= import('./airportSearchData').then(
    ({ GENERATED_AIRPORT_SEARCH_INDEX, REVIEWED_KOREAN_AIRPORT_ALIASES }) =>
      createAirportSearchCatalog(GENERATED_AIRPORT_SEARCH_INDEX, {
        aliases: REVIEWED_KOREAN_AIRPORT_ALIASES,
      }),
  );
  generatedCatalogPromise.catch(() => {
    // A transient same-site chunk failure should not poison all future opens.
    generatedCatalogPromise = undefined;
  });
  return generatedCatalogPromise;
}
