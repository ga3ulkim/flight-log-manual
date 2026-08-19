import { createHash } from 'node:crypto';

export const WIKIDATA_AIRLINE_ENDPOINT = 'https://query.wikidata.org/sparql';
export const WIKIDATA_AIRLINE_LICENSE = 'CC0-1.0';
export const AIRLINE_CESSATION_CUTOFF_YEAR = 2000;

/**
 * Keep this query narrow enough for WDQS while retaining the provenance needed
 * to make the historical cutoff auditable. Multi-value fields are URI encoded
 * before aggregation and are sorted/deduplicated locally after download.
 */
export const WIKIDATA_AIRLINE_CORE_QUERY = `
SELECT ?airline ?labelEn ?labelMul
  (GROUP_CONCAT(DISTINCT ENCODE_FOR_URI(STR(?iata)); separator="|") AS ?iataCodes)
  (GROUP_CONCAT(DISTINCT ENCODE_FOR_URI(STR(?icao)); separator="|") AS ?icaoCodes)
  (GROUP_CONCAT(DISTINCT ENCODE_FOR_URI(STR(?countryLabel)); separator="|") AS ?countries)
  (GROUP_CONCAT(
    DISTINCT CONCAT(
      ENCODE_FOR_URI(STR(?dissolved)),
      "~",
      STR(?dissolvedPrecision)
    );
    separator="|"
  ) AS ?dissolvedDates)
WHERE {
  ?airline wdt:P31/wdt:P279* wd:Q46970.

  OPTIONAL {
    ?airline rdfs:label ?labelEn.
    FILTER(LANG(?labelEn) = "en")
  }
  OPTIONAL {
    ?airline rdfs:label ?labelMul.
    FILTER(LANG(?labelMul) = "mul")
  }
  FILTER(BOUND(?labelEn) || BOUND(?labelMul))

  OPTIONAL {
    ?airline p:P229 ?iataStatement.
    ?iataStatement wikibase:rank ?iataRank;
      ps:P229 ?iata.
    FILTER(?iataRank != wikibase:DeprecatedRank)
  }
  OPTIONAL {
    ?airline p:P230 ?icaoStatement.
    ?icaoStatement wikibase:rank ?icaoRank;
      ps:P230 ?icao.
    FILTER(?icaoRank != wikibase:DeprecatedRank)
  }
  OPTIONAL {
    ?airline wdt:P17 ?country.
    ?country rdfs:label ?countryLabel.
    FILTER(LANG(?countryLabel) = "en")
  }
  OPTIONAL {
    ?airline p:P576 ?dissolvedStatement.
    ?dissolvedStatement wikibase:rank ?dissolvedRank;
      psv:P576 ?dissolvedValue.
    FILTER(?dissolvedRank != wikibase:DeprecatedRank)
    ?dissolvedValue wikibase:timeValue ?dissolved;
      wikibase:timePrecision ?dissolvedPrecision.
  }
}
GROUP BY ?airline ?labelEn ?labelMul
ORDER BY ?airline
`.trim();

// Aliases are intentionally fetched separately. Keeping this one-to-many field
// out of the core aggregate avoids a large codes/countries/dates cross-product
// and keeps the public WDQS request comfortably below its timeout in practice.
export const WIKIDATA_AIRLINE_ALIAS_QUERY = `
SELECT ?airline
  (GROUP_CONCAT(DISTINCT ENCODE_FOR_URI(STR(?alias)); separator="|") AS ?aliases)
WHERE {
  ?airline wdt:P31/wdt:P279* wd:Q46970;
    skos:altLabel ?alias.
  FILTER(LANG(?alias) = "en")
}
GROUP BY ?airline
ORDER BY ?airline
`.trim();

export const WIKIDATA_AIRLINE_QUERIES = Object.freeze([
  WIKIDATA_AIRLINE_CORE_QUERY,
  WIKIDATA_AIRLINE_ALIAS_QUERY,
]);

/** Canonical text hashed into generated provenance; not sent as one query. */
export const WIKIDATA_AIRLINE_QUERY = WIKIDATA_AIRLINE_QUERIES.join(
  '\n\n# --- companion query ---\n\n',
);

const WIKIDATA_ENTITY_PATTERN = /^https?:\/\/www\.wikidata\.org\/entity\/(Q[1-9]\d*)$/;
const IATA_PATTERN = /^[A-Z0-9]{2}$/;
const ICAO_PATTERN = /^[A-Z]{3}$/;
const YEAR_OR_FINER_PRECISION = 9;
const LATIN_LETTER_PATTERN = /\p{Script=Latin}/u;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/gu;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeWhitespace(value) {
  return value
    .replace(CONTROL_CHARACTER_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedIdentity(value) {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareText);
}

function readOptionalBinding(binding, property) {
  const value = binding?.[property];
  if (value === undefined) return '';
  if (
    value === null
    || typeof value !== 'object'
    || typeof value.value !== 'string'
  ) {
    throw new Error(`Wikidata binding ${property} is not a string value.`);
  }
  return value.value;
}

function decodeAggregatedValues(rawValue, property) {
  if (!rawValue) return [];
  return rawValue.split('|').map((encoded) => {
    try {
      return normalizeWhitespace(decodeURIComponent(encoded));
    } catch {
      throw new Error(`Wikidata binding ${property} contains invalid URI encoding.`);
    }
  }).filter(Boolean);
}

function parseDissolutionValue(value) {
  const separatorIndex = value.lastIndexOf('~');
  if (separatorIndex < 1) return Object.freeze({ year: null, precision: null });

  const rawDate = value.slice(0, separatorIndex);
  const precision = Number(value.slice(separatorIndex + 1));
  const match = /^([+-]?\d{1,16})-\d{2}-\d{2}T/.exec(rawDate);
  const year = match ? Number(match[1]) : Number.NaN;
  return Object.freeze({
    year: Number.isSafeInteger(year) ? year : null,
    precision: Number.isInteger(precision) ? precision : null,
  });
}

/**
 * Exclude only when every non-deprecated cessation statement reliably places
 * cessation before 2000. Missing, malformed, coarse, or conflicting values are
 * retained so an incomplete upstream date never silently hides an airline.
 */
export function isEligibleByDissolution(
  dissolutionValues,
  cutoffYear = AIRLINE_CESSATION_CUTOFF_YEAR,
) {
  if (dissolutionValues.length === 0) return true;

  let sawReliableDate = false;
  for (const value of dissolutionValues) {
    const { year, precision } = typeof value === 'string'
      ? parseDissolutionValue(value)
      : value;
    if (
      year === null
      || precision === null
      || precision < YEAR_OR_FINER_PRECISION
    ) {
      return true;
    }
    sawReliableDate = true;
    if (year >= cutoffYear) return true;
  }
  return !sawReliableDate;
}

function chooseCanonicalName(englishLabels, multilingualLabels) {
  const english = uniqueSorted(
    englishLabels.map(normalizeWhitespace).filter(Boolean),
  );
  if (english.length > 0) return english[0];

  // Wikidata's `mul` label is language-independent. It is a useful upstream
  // canonical fallback for invariant Latin brands (not a fabricated translation).
  const multilingual = uniqueSorted(
    multilingualLabels
      .map(normalizeWhitespace)
      .filter((label) => label && LATIN_LETTER_PATTERN.test(label)),
  );
  return multilingual[0] ?? '';
}

function createAccumulator(qid) {
  return {
    qid,
    englishLabels: [],
    multilingualLabels: [],
    iataCodes: [],
    icaoCodes: [],
    countries: [],
    aliases: [],
    dissolutionValues: [],
  };
}

function assertSparqlResults(document) {
  if (
    document === null
    || typeof document !== 'object'
    || document.results === null
    || typeof document.results !== 'object'
    || !Array.isArray(document.results.bindings)
  ) {
    throw new Error('Wikidata response is not a SPARQL JSON results document.');
  }
  return document.results.bindings;
}

function recordSortKey(record) {
  return [
    normalizedIdentity(record.name),
    record.name,
    record.iataCodes.join('|'),
    record.icaoCodes.join('|'),
    record.country,
    record.qid,
  ];
}

function compareRecords(left, right) {
  const leftKey = recordSortKey(left);
  const rightKey = recordSortKey(right);
  for (let index = 0; index < leftKey.length; index += 1) {
    const comparison = compareText(leftKey[index], rightKey[index]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

export function buildAirlineIndex(source) {
  let document;
  try {
    document = typeof source === 'string' ? JSON.parse(source) : source;
  } catch (error) {
    throw new Error(`Wikidata response is not valid JSON: ${error.message}`);
  }

  const bindings = assertSparqlResults(document);
  const accumulators = new Map();
  const rejected = {
    missingCanonicalName: 0,
    invalidIata: 0,
    invalidIcao: 0,
    ceasedBeforeCutoff: 0,
    duplicateBrowserRows: 0,
  };

  for (const binding of bindings) {
    if (binding === null || typeof binding !== 'object') {
      throw new Error('Wikidata response contains a non-object binding.');
    }
    const entityUri = readOptionalBinding(binding, 'airline');
    const entityMatch = WIKIDATA_ENTITY_PATTERN.exec(entityUri);
    if (!entityMatch) {
      throw new Error(`Invalid Wikidata airline entity URI: ${entityUri || '(missing)'}`);
    }
    const qid = entityMatch[1];
    const accumulator = accumulators.get(qid) ?? createAccumulator(qid);

    const labelEn = normalizeWhitespace(readOptionalBinding(binding, 'labelEn'));
    const labelMul = normalizeWhitespace(readOptionalBinding(binding, 'labelMul'));
    if (labelEn) accumulator.englishLabels.push(labelEn);
    if (labelMul) accumulator.multilingualLabels.push(labelMul);
    accumulator.iataCodes.push(
      ...decodeAggregatedValues(readOptionalBinding(binding, 'iataCodes'), 'iataCodes'),
    );
    accumulator.icaoCodes.push(
      ...decodeAggregatedValues(readOptionalBinding(binding, 'icaoCodes'), 'icaoCodes'),
    );
    accumulator.countries.push(
      ...decodeAggregatedValues(readOptionalBinding(binding, 'countries'), 'countries'),
    );
    accumulator.aliases.push(
      ...decodeAggregatedValues(readOptionalBinding(binding, 'aliases'), 'aliases'),
    );
    accumulator.dissolutionValues.push(
      ...decodeAggregatedValues(
        readOptionalBinding(binding, 'dissolvedDates'),
        'dissolvedDates',
      ),
    );
    accumulators.set(qid, accumulator);
  }

  const records = [];
  for (const accumulator of accumulators.values()) {
    const name = chooseCanonicalName(
      accumulator.englishLabels,
      accumulator.multilingualLabels,
    );
    if (!name) {
      rejected.missingCanonicalName += 1;
      continue;
    }

    const dissolutionValues = uniqueSorted(accumulator.dissolutionValues);
    if (!isEligibleByDissolution(dissolutionValues)) {
      rejected.ceasedBeforeCutoff += 1;
      continue;
    }

    const rawIataCodes = uniqueSorted(
      accumulator.iataCodes.map((code) => code.toUpperCase()),
    );
    const rawIcaoCodes = uniqueSorted(
      accumulator.icaoCodes.map((code) => code.toUpperCase()),
    );
    const iataCodes = rawIataCodes.filter((code) => IATA_PATTERN.test(code));
    const icaoCodes = rawIcaoCodes.filter((code) => ICAO_PATTERN.test(code));
    rejected.invalidIata += rawIataCodes.length - iataCodes.length;
    rejected.invalidIcao += rawIcaoCodes.length - icaoCodes.length;

    const countries = uniqueSorted(
      accumulator.countries.map(normalizeWhitespace).filter(Boolean),
    );
    const excludedAliasIdentities = new Set([
      normalizedIdentity(name),
      ...iataCodes.map(normalizedIdentity),
      ...icaoCodes.map(normalizedIdentity),
    ]);
    const aliases = uniqueSorted(
      accumulator.aliases
        .map(normalizeWhitespace)
        .filter(Boolean)
        .filter((alias) => !excludedAliasIdentities.has(normalizedIdentity(alias))),
    );

    records.push(Object.freeze({
      qid: accumulator.qid,
      name,
      iataCodes: Object.freeze(iataCodes),
      icaoCodes: Object.freeze(icaoCodes),
      country: countries.join(' / '),
      aliases: Object.freeze(aliases),
      dissolutionValues: Object.freeze(dissolutionValues),
    }));
  }
  records.sort(compareRecords);

  const searchEntries = [];
  const seenRows = new Set();
  for (const record of records) {
    const tuple = Object.freeze([
      record.name,
      record.iataCodes,
      record.icaoCodes,
      record.country,
      record.aliases,
    ]);
    const identity = JSON.stringify(tuple);
    if (seenRows.has(identity)) {
      rejected.duplicateBrowserRows += 1;
      continue;
    }
    seenRows.add(identity);
    searchEntries.push(tuple);
  }

  validateAirlineSearchIndex(searchEntries);
  return Object.freeze({
    records: Object.freeze(records),
    searchEntries: Object.freeze(searchEntries),
    stats: Object.freeze({
      sourceRows: bindings.length,
      sourceEntities: accumulators.size,
      airlineCount: searchEntries.length,
      ...rejected,
    }),
  });
}

function compareSearchTuples(left, right) {
  return compareRecords(
    {
      qid: '',
      name: left[0],
      iataCodes: left[1],
      icaoCodes: left[2],
      country: left[3],
    },
    {
      qid: '',
      name: right[0],
      iataCodes: right[1],
      icaoCodes: right[2],
      country: right[3],
    },
  );
}

export function validateAirlineSearchIndex(searchEntries) {
  if (!Array.isArray(searchEntries) || searchEntries.length === 0) {
    throw new Error('Generated airline search index is empty.');
  }

  const seen = new Set();
  let previous = null;
  searchEntries.forEach((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 5) {
      throw new Error(`Invalid generated airline tuple at row ${index}.`);
    }
    const [name, iataCodes, icaoCodes, country, aliases] = entry;
    if (typeof name !== 'string' || normalizeWhitespace(name) !== name || !name) {
      throw new Error(`Invalid generated airline name at row ${index}.`);
    }
    if (!Array.isArray(iataCodes) || iataCodes.some((code) => !IATA_PATTERN.test(code))) {
      throw new Error(`Invalid generated airline IATA codes for ${name}.`);
    }
    if (!Array.isArray(icaoCodes) || icaoCodes.some((code) => !ICAO_PATTERN.test(code))) {
      throw new Error(`Invalid generated airline ICAO codes for ${name}.`);
    }
    if (typeof country !== 'string' || normalizeWhitespace(country) !== country) {
      throw new Error(`Invalid generated airline country for ${name}.`);
    }
    if (
      !Array.isArray(aliases)
      || aliases.some(
        (alias) =>
          typeof alias !== 'string'
          || !alias
          || normalizeWhitespace(alias) !== alias,
      )
    ) {
      throw new Error(`Invalid generated airline aliases for ${name}.`);
    }
    for (const values of [iataCodes, icaoCodes, aliases]) {
      if (values.some((value, valueIndex) => valueIndex > 0 && value <= values[valueIndex - 1])) {
        throw new Error(`Generated values are not uniquely sorted for ${name}.`);
      }
    }
    if (previous && compareSearchTuples(previous, entry) > 0) {
      throw new Error('Generated airline search index is not sorted.');
    }
    previous = entry;

    const identity = JSON.stringify(entry);
    if (seen.has(identity)) {
      throw new Error(`Duplicate generated airline tuple for ${name}.`);
    }
    seen.add(identity);
  });
  return searchEntries.length;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function formatGeneratedAirlineModule(
  searchEntries,
  { querySha256 = sha256(WIKIDATA_AIRLINE_QUERY), dataSha256 } = {},
) {
  validateAirlineSearchIndex(searchEntries);
  const canonicalData = `${JSON.stringify(searchEntries)}\n`;
  const resolvedDataSha256 = dataSha256 ?? sha256(canonicalData);
  const lines = searchEntries.map((entry) => `  ${JSON.stringify(entry)},`);

  return `/**
 * GENERATED FILE -- DO NOT EDIT BY HAND.
 *
 * Source: Wikidata Query Service structured data (CC0 1.0)
 * ${WIKIDATA_AIRLINE_ENDPOINT}
 * Scope: instances of airline (Q46970) or its subclasses with an English
 * label, or a Latin-script language-independent label when English is absent.
 * Historical policy: a record is excluded only when every usable,
 * non-deprecated cessation date has year-or-finer precision and is before
 * ${AIRLINE_CESSATION_CUTOFF_YEAR}. Missing/coarse/conflicting dates stay included.
 * Browser fields: canonical display name, IATA codes, ICAO codes, English
 * country labels, and English aliases. Wikidata IDs and dates are not bundled.
 * Regenerate with: npm run update-airlines
 */
import type { AirlineSearchTuple } from '../../lib/airlineSearch';

export const WIKIDATA_AIRLINE_DATA_URL = ${JSON.stringify(WIKIDATA_AIRLINE_ENDPOINT)};
export const WIKIDATA_AIRLINE_DATA_LICENSE = ${JSON.stringify(WIKIDATA_AIRLINE_LICENSE)};
export const WIKIDATA_AIRLINE_QUERY_SHA256 = ${JSON.stringify(querySha256)};
export const WIKIDATA_AIRLINE_DATA_SHA256 = ${JSON.stringify(resolvedDataSha256)};
export const GENERATED_AIRLINE_COUNT = ${searchEntries.length};

export const GENERATED_AIRLINE_SEARCH_INDEX = [
${lines.join('\n')}
] as const satisfies readonly AirlineSearchTuple[];
`;
}
