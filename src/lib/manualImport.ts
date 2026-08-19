import { resolveAirportCoordinate } from '../data/airports';
import type { Flight } from '../types';
import type { AirportSearchCatalog, AirportSearchEntry } from './airportSearch';
import {
  createManualAirportSnapshot,
  inferManualFlightType,
  isValidDateOnly,
  type ManualAirportSnapshot,
  type ManualFlightInput,
} from './manualFlight';

export interface LegacyFlightConversionResult {
  inputs: ManualFlightInput[];
  skipped: number;
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
