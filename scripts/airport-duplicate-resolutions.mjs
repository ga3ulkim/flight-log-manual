/**
 * Explicit choices for duplicate IATA codes that cannot be resolved by the
 * documented service/type priority in scripts/lib/airport-data.mjs.
 *
 * Values are OurAirports `ident` values. Keep this list empty unless the
 * updater reports an unresolved ambiguity, then verify the upstream records
 * before adding a documented selection here.
 */
export const DUPLICATE_IATA_SELECTIONS = Object.freeze({});
