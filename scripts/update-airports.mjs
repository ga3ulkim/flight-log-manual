import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DUPLICATE_IATA_SELECTIONS } from './airport-duplicate-resolutions.mjs';
import {
  OURAIRPORTS_SOURCE_URL,
  buildAirportIndex,
  formatGeneratedAirportModule,
  formatGeneratedAirportSearchModule,
  validateAirportIndex,
  validateAirportSearchIndex,
} from './lib/airport-data.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const coordinateOutputPath = fileURLToPath(
  new URL('../src/data/generated/ourAirports.ts', import.meta.url),
);
const searchOutputPath = fileURLToPath(
  new URL('../src/data/generated/airportSearch.ts', import.meta.url),
);

function parseArguments(argumentsList) {
  const options = { source: OURAIRPORTS_SOURCE_URL };
  for (let index = 0; index < argumentsList.length; index += 1) {
    if (argumentsList[index] === '--source' && argumentsList[index + 1]) {
      options.source = argumentsList[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argumentsList[index]}`);
    }
  }
  return options;
}

async function readSource(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: { 'User-Agent': 'Personal-Flight-Log-Airport-Updater/1.0' },
    });
    if (!response.ok) {
      throw new Error(`OurAirports download failed: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
  return readFile(source);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function writeGeneratedFile(outputPath, generated) {
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
  const sourceText = sourceBuffer.toString('utf8');
  const result = buildAirportIndex(sourceText, {
    duplicateSelections: DUPLICATE_IATA_SELECTIONS,
  });
  const canonicalCoordinates = JSON.stringify(Object.entries(result.airports));
  const coordinateSha256 = sha256(canonicalCoordinates);
  const canonicalSearchEntries = JSON.stringify(result.searchEntries);
  const searchSha256 = sha256(canonicalSearchEntries);
  validateAirportIndex(result.airports);
  validateAirportSearchIndex(result.searchEntries, result.airports);
  const generatedCoordinates = formatGeneratedAirportModule(
    result.airports,
    coordinateSha256,
  );
  const generatedSearch = formatGeneratedAirportSearchModule(
    result.searchEntries,
    searchSha256,
  );
  const coordinateChanged = await writeGeneratedFile(
    coordinateOutputPath,
    generatedCoordinates,
  );
  const searchChanged = await writeGeneratedFile(searchOutputPath, generatedSearch);

  console.log(`OurAirports source: ${source}`);
  console.log(`Repository: ${repositoryRoot}`);
  console.log(`Downloaded: ${sourceBuffer.byteLength.toLocaleString('en-US')} bytes`);
  console.log(`Source SHA-256: ${sha256(sourceBuffer)}`);
  console.log(`Rows inspected: ${result.stats.sourceRows.toLocaleString('en-US')}`);
  console.log(`Generated IATA airports: ${result.stats.airportCount.toLocaleString('en-US')}`);
  console.log(
    `Rejected rows: ${result.stats.missingIata.toLocaleString('en-US')} missing IATA, ` +
      `${result.stats.invalidIata.toLocaleString('en-US')} invalid IATA, ` +
      `${result.stats.invalidCoordinates.toLocaleString('en-US')} invalid coordinates`,
  );
  console.log(`Duplicate IATA codes resolved: ${result.stats.duplicateCodes}`);
  for (const report of result.duplicateReports) {
    console.log(
      `  ${report.code}: ${report.candidateCount} rows -> ${report.selectedIdent} (${report.reason})`,
    );
  }
  console.log(`Coordinate SHA-256: ${coordinateSha256}`);
  console.log(`Search SHA-256: ${searchSha256}`);
  console.log(
    `Coordinate module: ${Buffer.byteLength(generatedCoordinates).toLocaleString('en-US')} bytes`,
  );
  console.log(
    `Lazy search module: ${Buffer.byteLength(generatedSearch).toLocaleString('en-US')} bytes`,
  );
  console.log(
    coordinateChanged ? 'Coordinate index updated.' : 'Coordinate index unchanged.',
  );
  console.log(searchChanged ? 'Airport search index updated.' : 'Airport search index unchanged.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
