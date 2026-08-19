export const DEFAULT_AIRLINE_SEARCH_LIMIT = 8;
export const MAX_AIRLINE_SEARCH_LIMIT = 50;

export type AirlineSearchTuple = readonly [
  name: string,
  iataCodes: readonly string[],
  icaoCodes: readonly string[],
  country: string,
  aliases: readonly string[],
];

export interface AirlineSearchEntry {
  readonly name: string;
  readonly iata: string;
  readonly icao: string;
  readonly country: string;
}

export interface AirlineSearchIdentity {
  readonly name: string;
  readonly iata?: string;
  readonly icao?: string;
  readonly country?: string;
}

export interface AirlineSearchCatalog {
  readonly size: number;
  search(query: string, limit?: number): readonly AirlineSearchEntry[];
  findByCanonicalName(name: string): AirlineSearchEntry | undefined;
  findBySnapshot(snapshot: AirlineSearchIdentity): AirlineSearchEntry | undefined;
}

interface PreparedAirline {
  readonly entry: AirlineSearchEntry;
  readonly rawIataCodes: readonly string[];
  readonly rawIcaoCodes: readonly string[];
  readonly iataCodes: readonly string[];
  readonly icaoCodes: readonly string[];
  readonly name: string;
  readonly aliases: readonly string[];
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePreparedAirlines(
  left: PreparedAirline,
  right: PreparedAirline,
): number {
  return compareText(left.name, right.name)
    || compareText(left.entry.name, right.entry.name)
    || compareText(left.iataCodes.join('|'), right.iataCodes.join('|'))
    || compareText(left.icaoCodes.join('|'), right.icaoCodes.join('|'))
    || compareText(left.entry.country, right.entry.country);
}

function isWordPrefix(value: string, query: string): boolean {
  return value.startsWith(query) || value.includes(` ${query}`);
}

function resolveLimit(requestedLimit: number | undefined): number {
  if (requestedLimit === undefined || !Number.isFinite(requestedLimit)) {
    return DEFAULT_AIRLINE_SEARCH_LIMIT;
  }
  return Math.min(
    MAX_AIRLINE_SEARCH_LIMIT,
    Math.max(0, Math.floor(requestedLimit)),
  );
}

function matchRank(airline: PreparedAirline, query: string): number | null {
  if (airline.iataCodes.includes(query)) return 0;
  if (airline.icaoCodes.includes(query)) return 1;
  if (airline.name === query) return 2;
  if (airline.aliases.includes(query)) return 3;
  if (airline.iataCodes.some((code) => code.startsWith(query))) return 4;
  if (airline.icaoCodes.some((code) => code.startsWith(query))) return 5;
  if (isWordPrefix(airline.name, query)) return 6;
  if (airline.aliases.some((alias) => isWordPrefix(alias, query))) return 7;
  if (airline.name.includes(query)) return 8;
  if (airline.aliases.some((alias) => alias.includes(query))) return 9;
  if (airline.iataCodes.some((code) => code.includes(query))) return 10;
  if (airline.icaoCodes.some((code) => code.includes(query))) return 11;
  return null;
}

function matchedCode(
  rawCodes: readonly string[],
  normalizedCodes: readonly string[],
  query: string,
  predicate: (code: string, query: string) => boolean,
): string {
  const matches = rawCodes.filter((_, index) => predicate(normalizedCodes[index], query));
  return matches.length === 1 ? matches[0] : '';
}

function entryForMatch(
  airline: PreparedAirline,
  query: string,
  rank: number,
): AirlineSearchEntry {
  let iata = airline.entry.iata;
  let icao = airline.entry.icao;
  if (rank === 0) {
    iata = matchedCode(
      airline.rawIataCodes,
      airline.iataCodes,
      query,
      (code, value) => code === value,
    );
  } else if (rank === 1) {
    icao = matchedCode(
      airline.rawIcaoCodes,
      airline.icaoCodes,
      query,
      (code, value) => code === value,
    );
  } else if (rank === 4) {
    iata = matchedCode(
      airline.rawIataCodes,
      airline.iataCodes,
      query,
      (code, value) => code.startsWith(value),
    );
  } else if (rank === 5) {
    icao = matchedCode(
      airline.rawIcaoCodes,
      airline.icaoCodes,
      query,
      (code, value) => code.startsWith(value),
    );
  } else if (rank === 10) {
    iata = matchedCode(
      airline.rawIataCodes,
      airline.iataCodes,
      query,
      (code, value) => code.includes(value),
    );
  } else if (rank === 11) {
    icao = matchedCode(
      airline.rawIcaoCodes,
      airline.icaoCodes,
      query,
      (code, value) => code.includes(value),
    );
  }
  if (iata === airline.entry.iata && icao === airline.entry.icao) {
    return airline.entry;
  }
  return Object.freeze({ ...airline.entry, iata, icao });
}

function entryForSnapshot(
  airline: PreparedAirline,
  snapshot: AirlineSearchIdentity,
): AirlineSearchEntry {
  const iata = normalizeSearchText(snapshot.iata ?? '');
  const icao = normalizeSearchText(snapshot.icao ?? '');
  return Object.freeze({
    ...airline.entry,
    ...(iata
      ? { iata: airline.rawIataCodes[airline.iataCodes.indexOf(iata)] }
      : {}),
    ...(icao
      ? { icao: airline.rawIcaoCodes[airline.icaoCodes.indexOf(icao)] }
      : {}),
  });
}

/** Prepare the generated snapshot once when the flight editor first opens. */
export function createAirlineSearchCatalog(
  tuples: readonly AirlineSearchTuple[],
): AirlineSearchCatalog {
  const prepared = tuples.map((tuple) => {
    const [name, rawIataCodes, rawIcaoCodes, country, rawAliases] = tuple;
    const iataCodes = rawIataCodes.map((code) => normalizeSearchText(code));
    const icaoCodes = rawIcaoCodes.map((code) => normalizeSearchText(code));
    const entry = Object.freeze({
      name,
      // Multiple non-deprecated codes have no reliable current/pairing signal
      // in the compact source. Expose one only when it is unambiguous; a code
      // query below still returns the exact matching retained code.
      iata: rawIataCodes.length === 1 ? rawIataCodes[0] : '',
      icao: rawIcaoCodes.length === 1 ? rawIcaoCodes[0] : '',
      country,
    });
    return Object.freeze({
      entry,
      rawIataCodes: Object.freeze([...rawIataCodes]),
      rawIcaoCodes: Object.freeze([...rawIcaoCodes]),
      iataCodes: Object.freeze(iataCodes),
      icaoCodes: Object.freeze(icaoCodes),
      name: normalizeSearchText(name),
      aliases: Object.freeze(rawAliases.map(normalizeSearchText).filter(Boolean)),
    });
  });
  prepared.sort(comparePreparedAirlines);

  const byCanonicalName = new Map<string, PreparedAirline[]>();
  for (const airline of prepared) {
    const matches = byCanonicalName.get(airline.name) ?? [];
    matches.push(airline);
    byCanonicalName.set(airline.name, matches);
  }

  return Object.freeze({
    size: prepared.length,
    findByCanonicalName(name: string) {
      const matches = byCanonicalName.get(normalizeSearchText(name));
      return matches?.length === 1 ? matches[0].entry : undefined;
    },
    findBySnapshot(snapshot: AirlineSearchIdentity) {
      const matches = byCanonicalName.get(normalizeSearchText(snapshot.name));
      if (!matches) return undefined;
      const iata = normalizeSearchText(snapshot.iata ?? '');
      const icao = normalizeSearchText(snapshot.icao ?? '');
      const country = normalizeSearchText(snapshot.country ?? '');
      const identified = matches.filter((airline) =>
        (!iata || airline.iataCodes.includes(iata))
        && (!icao || airline.icaoCodes.includes(icao))
        && (!country || normalizeSearchText(airline.entry.country) === country));
      return identified.length === 1
        ? entryForSnapshot(identified[0], snapshot)
        : undefined;
    },
    search(query: string, requestedLimit = DEFAULT_AIRLINE_SEARCH_LIMIT) {
      const normalizedQuery = normalizeSearchText(query);
      const limit = resolveLimit(requestedLimit);
      if (!normalizedQuery || limit === 0) return [];

      const buckets: PreparedAirline[][] = Array.from(
        { length: 12 },
        () => [],
      );
      for (const airline of prepared) {
        const rank = matchRank(airline, normalizedQuery);
        if (rank !== null) buckets[rank].push(airline);
      }

      const matches: AirlineSearchEntry[] = [];
      for (let rank = 0; rank < buckets.length; rank += 1) {
        const bucket = buckets[rank];
        for (const airline of bucket) {
          matches.push(entryForMatch(airline, normalizedQuery, rank));
          if (matches.length === limit) return matches;
        }
      }
      return matches;
    },
  });
}

const defaultCatalogs = new WeakMap<
  readonly AirlineSearchTuple[],
  AirlineSearchCatalog
>();

export function searchAirlines(
  tuples: readonly AirlineSearchTuple[],
  query: string,
  limit = DEFAULT_AIRLINE_SEARCH_LIMIT,
): readonly AirlineSearchEntry[] {
  let catalog = defaultCatalogs.get(tuples);
  if (!catalog) {
    catalog = createAirlineSearchCatalog(tuples);
    defaultCatalogs.set(tuples, catalog);
  }
  return catalog.search(query, limit);
}

let generatedCatalogPromise: Promise<AirlineSearchCatalog> | undefined;

/** Load airline names/codes only when an add/edit surface needs them. */
export function loadAirlineSearchCatalog(): Promise<AirlineSearchCatalog> {
  generatedCatalogPromise ??= import('./airlineSearchData').then(
    ({ GENERATED_AIRLINE_SEARCH_INDEX }) =>
      createAirlineSearchCatalog(GENERATED_AIRLINE_SEARCH_INDEX),
  );
  generatedCatalogPromise.catch(() => {
    generatedCatalogPromise = undefined;
  });
  return generatedCatalogPromise;
}
