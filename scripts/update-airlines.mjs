import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  WIKIDATA_AIRLINE_ENDPOINT,
  WIKIDATA_AIRLINE_QUERY,
  WIKIDATA_AIRLINE_QUERIES,
  buildAirlineIndex,
  formatGeneratedAirlineModule,
  sha256,
  validateAirlineSearchIndex,
} from './lib/airline-data.mjs';

const outputPath = fileURLToPath(
  new URL('../src/data/generated/airlines.ts', import.meta.url),
);
const USER_AGENT =
  'Personal-Flight-Log-Airline-Updater/1.0 '
  + '(https://github.com/ga3ulkim/flight-log-manual)';
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function parseArguments(argumentsList) {
  const options = { source: null };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--source' && argumentsList[index + 1]) {
      options.source = argumentsList[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  return options;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function executeWikidataQuery(query, queryIndex) {
  const body = new URLSearchParams({
    query,
    format: 'json',
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(WIKIDATA_AIRLINE_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': USER_AGENT,
      },
      body,
    });
    if (response.ok) return response.json();
    if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === 3) {
      throw new Error(
        `Wikidata query ${queryIndex + 1} failed: HTTP ${response.status}`,
      );
    }
    const retryAfter = Number(response.headers.get('Retry-After'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1_000, 15_000)
      : attempt * 2_000;
    console.warn(
      `Wikidata query ${queryIndex + 1} returned HTTP ${response.status}; `
      + `retrying in ${delay}ms.`,
    );
    await wait(delay);
  }
  throw new Error(`Wikidata query ${queryIndex + 1} exhausted its retries.`);
}

async function queryWikidata() {
  const bindings = [];
  for (let index = 0; index < WIKIDATA_AIRLINE_QUERIES.length; index += 1) {
    const document = await executeWikidataQuery(
      WIKIDATA_AIRLINE_QUERIES[index],
      index,
    );
    if (!Array.isArray(document?.results?.bindings)) {
      throw new Error(`Wikidata query ${index + 1} returned invalid SPARQL JSON.`);
    }
    bindings.push(...document.results.bindings);
  }
  return Buffer.from(JSON.stringify({
    head: { vars: [] },
    results: { bindings },
  }));
}

async function readSource(source) {
  if (!source) return queryWikidata();
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: {
        Accept: 'application/sparql-results+json',
        'User-Agent': USER_AGENT,
      },
    });
    if (!response.ok) {
      throw new Error(`Wikidata source download failed: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
  return readFile(source);
}

async function writeGeneratedFile(generated) {
  let previous = null;
  try {
    previous = await readFile(outputPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const changed = previous !== generated;
  if (changed) await writeFile(outputPath, generated, 'utf8');
  return changed;
}

async function main() {
  const { source } = parseArguments(process.argv.slice(2));
  const sourceBuffer = await readSource(source);
  const result = buildAirlineIndex(sourceBuffer.toString('utf8'));
  validateAirlineSearchIndex(result.searchEntries);

  const canonicalData = `${JSON.stringify(result.searchEntries)}\n`;
  const generated = formatGeneratedAirlineModule(result.searchEntries, {
    querySha256: sha256(WIKIDATA_AIRLINE_QUERY),
    dataSha256: sha256(canonicalData),
  });
  const changed = await writeGeneratedFile(generated);

  console.log(
    JSON.stringify({
      source: source ?? WIKIDATA_AIRLINE_ENDPOINT,
      sourceBytes: sourceBuffer.byteLength,
      sourceSha256: sha256(sourceBuffer),
      querySha256: sha256(WIKIDATA_AIRLINE_QUERY),
      dataSha256: sha256(canonicalData),
      changed,
      ...result.stats,
    }, null, 2),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
