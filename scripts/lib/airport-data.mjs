export const OURAIRPORTS_SOURCE_URL =
  'https://davidmegginson.github.io/ourairports-data/airports.csv';

export const EXPECTED_AIRPORT_COLUMNS = Object.freeze([
  'id',
  'ident',
  'type',
  'name',
  'latitude_deg',
  'longitude_deg',
  'iso_country',
  'municipality',
  'scheduled_service',
  'iata_code',
]);

const IATA_PATTERN = /^[A-Z]{3}$/;
const AIRPORT_TYPE_SCORE = Object.freeze({
  large_airport: 60,
  medium_airport: 50,
  small_airport: 40,
  seaplane_base: 30,
  heliport: 20,
  balloonport: 10,
  closed: 0,
});

function parseCsvRows(source) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (character !== '\r') {
      field += character;
    }
  }

  if (quoted) throw new Error('OurAirports CSV ended inside a quoted field.');
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function airportScore(candidate) {
  const scheduledScore = candidate.scheduledService === 'yes' ? 100 : 0;
  const typeScore = AIRPORT_TYPE_SCORE[candidate.type] ?? 0;
  return scheduledScore + typeScore;
}

function compareCandidateIdentity(left, right) {
  return (
    left.ident.localeCompare(right.ident, 'en') ||
    left.id.localeCompare(right.id, 'en')
  );
}

function sameCoordinate(left, right) {
  return left.latitude === right.latitude && left.longitude === right.longitude;
}

export function resolveDuplicateIata(code, candidates, explicitSelections = {}) {
  if (candidates.length < 2) {
    throw new Error(`Duplicate resolver for ${code} requires at least two rows.`);
  }

  const ordered = [...candidates].sort(compareCandidateIdentity);
  const explicitIdent = explicitSelections[code];
  if (explicitIdent) {
    const matching = ordered.filter((candidate) => candidate.ident === explicitIdent);
    if (matching.length !== 1) {
      throw new Error(
        `Duplicate selection ${code} -> ${explicitIdent} matched ${matching.length} rows.`,
      );
    }
    return { selected: matching[0], reason: `explicit ident ${explicitIdent}` };
  }

  if (ordered.every((candidate) => sameCoordinate(candidate, ordered[0]))) {
    return { selected: ordered[0], reason: 'equivalent coordinates' };
  }

  const scored = ordered.map((candidate) => ({
    candidate,
    score: airportScore(candidate),
  }));
  const highestScore = Math.max(...scored.map(({ score }) => score));
  const leaders = scored.filter(({ score }) => score === highestScore);
  if (leaders.length === 1) {
    const winner = leaders[0].candidate;
    return {
      selected: winner,
      reason: `unique service/type priority (${winner.scheduledService}, ${winner.type})`,
    };
  }

  const identities = leaders
    .map(({ candidate }) => `${candidate.ident} @ ${candidate.latitude},${candidate.longitude}`)
    .join('; ');
  throw new Error(
    `Ambiguous duplicate IATA ${code}: ${identities}. Add an explicit ident selection.`,
  );
}

function parseCoordinate(value, minimum, maximum) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const coordinate = Number(trimmed);
  if (!Number.isFinite(coordinate) || coordinate < minimum || coordinate > maximum) {
    return null;
  }
  // Six decimal places retain sub-metre precision while avoiding noisy source
  // floating-point tails in the browser bundle.
  return Number(coordinate.toFixed(6));
}

export function buildAirportIndex(csvSource, options = {}) {
  const rows = parseCsvRows(csvSource.replace(/^\uFEFF/, ''));
  if (rows.length === 0) throw new Error('OurAirports CSV is empty.');

  const header = rows[0].map((column) => column.trim());
  const duplicateHeaders = header.filter(
    (column, index) => column && header.indexOf(column) !== index,
  );
  if (duplicateHeaders.length > 0) {
    throw new Error(`OurAirports CSV has duplicate columns: ${duplicateHeaders.join(', ')}`);
  }

  const missingColumns = EXPECTED_AIRPORT_COLUMNS.filter(
    (column) => !header.includes(column),
  );
  if (missingColumns.length > 0) {
    throw new Error(`OurAirports CSV is missing columns: ${missingColumns.join(', ')}`);
  }

  const column = Object.fromEntries(header.map((name, index) => [name, index]));
  const candidatesByCode = new Map();
  const rejected = {
    missingIata: 0,
    invalidIata: 0,
    invalidCoordinates: 0,
  };

  for (const row of rows.slice(1)) {
    if (row.length === 1 && row[0] === '') continue;
    const rawCode = (row[column.iata_code] ?? '').trim().toUpperCase();
    if (!rawCode) {
      rejected.missingIata += 1;
      continue;
    }
    if (!IATA_PATTERN.test(rawCode)) {
      rejected.invalidIata += 1;
      continue;
    }

    const latitude = parseCoordinate(row[column.latitude_deg] ?? '', -90, 90);
    const longitude = parseCoordinate(row[column.longitude_deg] ?? '', -180, 180);
    if (latitude == null || longitude == null) {
      rejected.invalidCoordinates += 1;
      continue;
    }

    const candidate = {
      id: (row[column.id] ?? '').trim(),
      ident: (row[column.ident] ?? '').trim(),
      type: (row[column.type] ?? '').trim(),
      name: (row[column.name] ?? '').trim(),
      isoCountry: (row[column.iso_country] ?? '').trim(),
      municipality: (row[column.municipality] ?? '').trim(),
      scheduledService: (row[column.scheduled_service] ?? '').trim(),
      latitude,
      longitude,
    };
    const existing = candidatesByCode.get(rawCode) ?? [];
    existing.push(candidate);
    candidatesByCode.set(rawCode, existing);
  }

  const airports = {};
  const searchEntries = [];
  const duplicateReports = [];
  for (const code of [...candidatesByCode.keys()].sort()) {
    const candidates = candidatesByCode.get(code);
    let selected = candidates[0];
    if (candidates.length > 1) {
      const resolution = resolveDuplicateIata(
        code,
        candidates,
        options.duplicateSelections,
      );
      selected = resolution.selected;
      duplicateReports.push({
        code,
        candidateCount: candidates.length,
        selectedIdent: selected.ident,
        reason: resolution.reason,
      });
    }
    airports[code] = Object.freeze([selected.latitude, selected.longitude]);
    searchEntries.push(
      Object.freeze([
        code,
        selected.name,
        selected.municipality,
        selected.isoCountry.toUpperCase(),
      ]),
    );
  }

  return {
    airports: Object.freeze(airports),
    searchEntries: Object.freeze(searchEntries),
    duplicateReports: Object.freeze(duplicateReports),
    stats: Object.freeze({
      sourceRows: rows.length - 1,
      airportCount: Object.keys(airports).length,
      duplicateCodes: duplicateReports.length,
      ...rejected,
    }),
  };
}

export function validateAirportIndex(airports) {
  const entries = Object.entries(airports);
  if (entries.length === 0) throw new Error('Generated airport index is empty.');

  let previousCode = '';
  for (const [code, coordinate] of entries) {
    if (!IATA_PATTERN.test(code)) throw new Error(`Invalid generated IATA code: ${code}`);
    if (code <= previousCode) throw new Error('Generated airport index is not sorted.');
    previousCode = code;
    if (!Array.isArray(coordinate) || coordinate.length !== 2) {
      throw new Error(`Invalid generated coordinate tuple for ${code}.`);
    }
    const [latitude, longitude] = coordinate;
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new Error(`Invalid generated coordinates for ${code}.`);
    }
  }
  return entries.length;
}

/**
 * Validate the richer lazy-search rows and, when supplied, prove that they are
 * a one-to-one companion to the compact coordinate index from the same CSV.
 */
export function validateAirportSearchIndex(searchEntries, airports) {
  if (!Array.isArray(searchEntries) || searchEntries.length === 0) {
    throw new Error('Generated airport search index is empty.');
  }

  const coordinateCodes = airports ? Object.keys(airports) : null;
  if (coordinateCodes && coordinateCodes.length !== searchEntries.length) {
    throw new Error(
      'Generated airport search and coordinate indexes have different sizes.',
    );
  }

  let previousCode = '';
  for (let index = 0; index < searchEntries.length; index += 1) {
    const entry = searchEntries[index];
    if (!Array.isArray(entry) || entry.length !== 4) {
      throw new Error(`Invalid generated airport search tuple at row ${index}.`);
    }

    const [code, name, municipality, isoCountry] = entry;
    if (!IATA_PATTERN.test(code)) {
      throw new Error(`Invalid generated search IATA code: ${code}`);
    }
    if (code <= previousCode) {
      throw new Error('Generated airport search index is not sorted.');
    }
    previousCode = code;

    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(`Generated airport search name is missing for ${code}.`);
    }
    if (typeof municipality !== 'string') {
      throw new Error(`Invalid generated municipality for ${code}.`);
    }
    if (typeof isoCountry !== 'string' || !/^[A-Z]{2}$/.test(isoCountry)) {
      throw new Error(`Invalid generated ISO country for ${code}: ${isoCountry}`);
    }
    if (coordinateCodes && coordinateCodes[index] !== code) {
      throw new Error(
        `Generated airport search/coordinate mismatch at ${code}.`,
      );
    }
  }

  return searchEntries.length;
}

export function formatGeneratedAirportModule(airports, selectedDataSha256) {
  validateAirportIndex(airports);
  const lines = Object.entries(airports).map(
    ([code, coordinate]) =>
      `  ${JSON.stringify(code)}: [${coordinate[0]}, ${coordinate[1]}],`,
  );

  return `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Source: OurAirports airports.csv (Public Domain)
 * ${OURAIRPORTS_SOURCE_URL}
 * Fields retained in the browser bundle: IATA code, latitude, longitude.
 * Regenerate with: npm run update-airports
 */
import type { AirportCoordinatesByCode } from '../airports';

export const OURAIRPORTS_DATA_URL = ${JSON.stringify(OURAIRPORTS_SOURCE_URL)};
export const OURAIRPORTS_COORDINATE_SHA256 = ${JSON.stringify(selectedDataSha256)};
export const GENERATED_AIRPORT_COUNT = ${Object.keys(airports).length};

export const GENERATED_AIRPORT_COORDINATES = {
${lines.join('\n')}
} as const satisfies AirportCoordinatesByCode;
`;
}

export function formatGeneratedAirportSearchModule(
  searchEntries,
  selectedDataSha256,
) {
  validateAirportSearchIndex(searchEntries);
  const lines = searchEntries.map((entry) => `  ${JSON.stringify(entry)},`);

  return `/**
 * GENERATED FILE -- DO NOT EDIT BY HAND.
 *
 * Source: OurAirports airports.csv (Public Domain)
 * ${OURAIRPORTS_SOURCE_URL}
 * Fields retained for lazy airport search: IATA code, name, municipality,
 * ISO 3166-1 alpha-2 country code.
 * Regenerate together with the coordinate index: npm run update-airports
 */
import type { AirportSearchTuple } from '../../lib/airportSearch';

export const OURAIRPORTS_SEARCH_DATA_URL = ${JSON.stringify(OURAIRPORTS_SOURCE_URL)};
export const OURAIRPORTS_SEARCH_SHA256 = ${JSON.stringify(selectedDataSha256)};
export const GENERATED_AIRPORT_SEARCH_COUNT = ${searchEntries.length};

export const GENERATED_AIRPORT_SEARCH_INDEX = [
${lines.join('\n')}
] as const satisfies readonly AirportSearchTuple[];
`;
}
