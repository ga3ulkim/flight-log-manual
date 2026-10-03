import { describe, expect, it, vi } from 'vitest';
import { executeWikidataQuery } from './wikidata-request.mjs';

describe('Wikidata request failures', () => {
  it('aborts a stalled request and limits it to three timed attempts', async () => {
    const fetchImpl = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(executeWikidataQuery('query', 0, { fetchImpl, sleep, timeoutMs: 5 })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('retries a network rejection then returns valid JSON with a fresh bounded signal', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('network failure'))
      .mockResolvedValueOnce(new Response('{"results":{"bindings":[]}}'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(await executeWikidataQuery('query', 0, { fetchImpl, sleep })).toEqual({ results: { bindings: [] } });
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetchImpl.mock.calls[0][1].signal).not.toBe(fetchImpl.mock.calls[1][1].signal);
  });

  it('cancels a retryable HTTP body and caps Retry-After', async () => {
    const response = new Response('busy', { status: 429, headers: { 'Retry-After': '9999' } });
    const cancel = vi.spyOn(response.body, 'cancel');
    const fetchImpl = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(new Response('{}'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await executeWikidataQuery('query', 0, { fetchImpl, sleep });
    expect(cancel).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(15_000);
  });

  it.each([404, 400])('does not retry permanent HTTP %s failures', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status }));
    const sleep = vi.fn();
    await expect(executeWikidataQuery('query', 2, { fetchImpl, sleep })).rejects.toThrow(`query 3 failed: HTTP ${status}`);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('stops after three transient failures and does not retry malformed JSON', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(executeWikidataQuery('query', 0, { fetchImpl, sleep })).rejects.toThrow('timeout');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    const invalid = vi.fn().mockResolvedValue(new Response('invalid JSON'));
    await expect(executeWikidataQuery('query', 0, { fetchImpl: invalid, sleep })).rejects.toBeInstanceOf(SyntaxError);
    expect(invalid).toHaveBeenCalledOnce();
  });
});
