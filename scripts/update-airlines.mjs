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
import { executeWikidataQuery, WIKIDATA_USER_AGENT as USER_AGENT } from './lib/wikidata-request.mjs';

const outputPath = fileURLToPath(
  new URL('../src/data/generated/airlines.ts', import.meta.url),
);

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
      signal: AbortSignal.timeout(60_000),
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
