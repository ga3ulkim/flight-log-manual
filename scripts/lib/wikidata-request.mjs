import { WIKIDATA_AIRLINE_ENDPOINT } from './airline-data.mjs';

export const WIKIDATA_USER_AGENT =
  'Personal-Flight-Log-Airline-Updater/1.0 (https://github.com/ga3ulkim/flight-log-manual)';
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Retry only transient network/HTTP failures; malformed successful JSON is fatal. */
export async function executeWikidataQuery(query, queryIndex, {
  fetchImpl = fetch,
  sleep = wait,
  timeoutMs = 60_000,
} = {}) {
  const body = new URLSearchParams({ query, format: 'json' });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let delay = attempt * 2_000;
    try {
      const response = await fetchImpl(WIKIDATA_AIRLINE_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': WIKIDATA_USER_AGENT,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return await response.json();
      // Release the body/socket before waiting for a retry.
      await response.body?.cancel();
      if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === 3) {
        throw new Error(`Wikidata query ${queryIndex + 1} failed: HTTP ${response.status}`);
      }
      const retryAfter = Number(response.headers.get('Retry-After'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) delay = Math.min(retryAfter * 1_000, 15_000);
    } catch (error) {
      const transient = error instanceof TypeError || error?.name === 'TimeoutError' || error?.name === 'AbortError';
      if (!transient || attempt === 3) throw error;
    }
    await sleep(delay);
  }
  throw new Error(`Wikidata query ${queryIndex + 1} exhausted its retries.`);
}
