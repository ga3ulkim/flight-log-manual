import { resolveAirportCoordinate } from '../data/airports';
import type { Flight, ImportRowDiagnostic, ParseResult } from '../types';
import type { AirportSearchCatalog, AirportSearchEntry } from './airportSearch';
import {
  ManualFlightValidationError,
  createManualAirportSnapshot,
  createManualFlight,
  inferManualFlightType,
  isValidDateOnly,
  type ManualAirportSnapshot,
  type ManualFlightFactories,
  type ManualFlightInput,
  type ManualFlightRecord,
} from './manualFlight';

export interface LegacyFlightConversionResult {
  inputs: ManualFlightInput[];
  skipped: number;
}

export interface LegacyFlightRecordConversionResult {
  records: ManualFlightRecord[];
  skipped: number;
}

export interface LegacyImportPreview {
  flights: Flight[];
  dataRowCount: number;
  diagnostics: ImportRowDiagnostic[];
}

/** Preflight uses the same domain validation as the final atomic import. */
export function previewLegacyFlightImport(
  parsed: ParseResult,
  catalog: Pick<AirportSearchCatalog, 'findByIata'>,
): LegacyImportPreview {
  const diagnostics = [...(parsed.diagnostics ?? [])];
  const flights: Flight[] = [];
  parsed.flights.forEach((flight, index) => {
    const row = flight.sourceRow ?? index + 1;
    try {
      const { inputs } = legacyFlightsToManualInputs([flight], catalog);
      if (!inputs.length) {
        diagnostics.push({ row, message: legacyDateOnly(flight)
          ? '국가 정보 또는 명시적인 국내선·국제선 구분이 필요합니다.'
          : '유효한 연·월·일 날짜가 필요합니다.' });
        return;
      }
      createManualFlight(inputs[0], {
        generateId: () => 'import-preview',
        now: () => new Date('2000-01-01T00:00:00Z'),
      });
      flights.push(flight);
    } catch (error) {
      if (!(error instanceof ManualFlightValidationError)) throw error;
      diagnostics.push({ row, message: error.message });
    }
  });
  return {
    flights,
    dataRowCount: parsed.dataRowCount ?? parsed.flights.length + (parsed.diagnostics?.length ?? 0),
    diagnostics: diagnostics.sort((left, right) => left.row - right.row),
  };
}

function legacyDateOnly(flight: Flight): string | null {
  const normalized = (flight.sortKey || flight.d).trim().replace(/[./]/g, '-');
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(normalized);
  return match && isValidDateOnly(match[1]) ? match[1] : null;
}

function endpointSnapshot(
  code: string,
  city: string,
  countryName: string,
  entry: AirportSearchEntry | undefined,
): ManualAirportSnapshot {
  const coordinate = resolveAirportCoordinate(code);
  return createManualAirportSnapshot(
    {
      iata: code,
      name: entry?.name ?? '',
      municipality: city || entry?.municipality || '',
      countryCode: entry?.countryCode ?? '',
      countryName: countryName || entry?.countryName || '',
      timezoneId: entry?.timezoneId,
    },
    coordinate,
  );
}

/** Convert locally parsed legacy rows without deduplicating legitimate flights. */
export function legacyFlightsToManualInputs(
  flights: readonly Flight[],
  catalog: Pick<AirportSearchCatalog, 'findByIata'>,
): LegacyFlightConversionResult {
  const inputs: ManualFlightInput[] = [];
  let skipped = 0;

  for (const flight of flights) {
    const date = legacyDateOnly(flight);
    if (!date) {
      skipped += 1;
      continue;
    }
    const departure = endpointSnapshot(
      flight.fa,
      flight.fcity,
      flight.fc,
      catalog.findByIata(flight.fa),
    );
    const arrival = endpointSnapshot(
      flight.ta,
      flight.tcity,
      flight.tc,
      catalog.findByIata(flight.ta),
    );
    const inferredType = inferManualFlightType(departure, arrival);
    const trustedType = inferredType
      ?? (flight.typeSource === 'fallback' ? null : flight.type);
    if (!trustedType) {
      skipped += 1;
      continue;
    }

    inputs.push({
      date,
      ...(flight.departureTime ? { departureTime: flight.departureTime } : {}),
      departure,
      arrival,
      airline: flight.al,
      flightNumber: flight.fn,
      aircraft: flight.ac,
      type: trustedType,
    });
  }

  return { inputs, skipped };
}

/**
 * Convert and validate legacy rows before the repository is touched. Expected
 * row-level validation failures are skipped, while unexpected failures still
 * abort the whole preflight so callers can retain atomic merge semantics.
 */
export function legacyFlightsToManualRecords(
  flights: readonly Flight[],
  catalog: Pick<AirportSearchCatalog, 'findByIata'>,
  factoriesForIndex: (index: number) => ManualFlightFactories = () => ({}),
): LegacyFlightRecordConversionResult {
  const converted = legacyFlightsToManualInputs(flights, catalog);
  const records: ManualFlightRecord[] = [];
  let skipped = converted.skipped;

  converted.inputs.forEach((input, index) => {
    try {
      records.push(createManualFlight(input, factoriesForIndex(index)));
    } catch (error) {
      if (!(error instanceof ManualFlightValidationError)) throw error;
      skipped += 1;
    }
  });

  return { records, skipped };
}
