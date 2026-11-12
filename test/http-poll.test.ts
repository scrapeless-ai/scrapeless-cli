import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { ApiClient } from '../src/http.js';
import { merge } from '../src/data.js';
import { poll } from '../src/poll.js';
import { scrapingResult } from '../src/scraping-api/client.js';

afterEach(() => mock.restoreAll());

test('Scraping API polling deadline aborts an in-flight GET', async () => {
  mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    await sleep(1000, undefined, { signal: options.signal! });
    return new Response('{}');
  });
  await assert.rejects(scrapingResult(new ApiClient('secret'), 'existing', { timeout: 20, interval: 1 }), /polling timed out.*existing/);
});

test('HTTP rejects invalid JSON, API error envelopes and redirects', async () => {
  const client = new ApiClient('secret');
  mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    assert.equal(options.redirect, 'error');
    return new Response('<html>bad gateway</html>');
  });
  await assert.rejects(client.request('/test'), /invalid JSON/);
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ success: false, message: 'denied' })));
  await assert.rejects(client.request('/test'), /denied/);
});

test('HTTP request timeout aborts requests', async () => {
  mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    await sleep(100, undefined, { signal: options.signal! });
    return new Response('{}');
  });
  await assert.rejects(new ApiClient('secret', undefined, 10).request('/test'), /timed out/);
});

test('polling deadline aborts an in-flight GET and preserves the last result', async () => {
  let calls = 0;
  const result = await poll(async signal => {
    if (++calls === 1) return { status: 'running', completed: 3 };
    await sleep(1000, undefined, { signal });
    return { status: 'success' };
  }, ['success', 'failed'], 30, 1);
  assert.equal(result.timedOut, true);
  assert.deepEqual(result.result, { status: 'running', completed: 3 });
});

test('polling surfaces errors and stops immediately at terminal states', async () => {
  await assert.rejects(poll(async () => { throw new Error('HTTP 401'); }, ['success']), /HTTP 401/);
  assert.deepEqual(await poll(async () => ({ status: 'failed', message: 'bad' }), ['success', 'failed']), {
    result: { status: 'failed', message: 'bad' }, timedOut: false,
  });
});

test('JSON merging rejects prototype pollution', () => {
  assert.throws(() => merge(JSON.parse('{"__proto__":{"polluted":true}}')), /Invalid key/);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test('existing HTTP callers retain error formatting, envelope checks and token redaction', async () => {
  const client = new ApiClient('secret');
  for (const [status, body, message] of [
    [401, { message: 'Invalid secret', details: { reason: 'auth' } }, 'HTTP 401: Invalid ********'],
    [500, { error: { reason: 'unavailable' }, details: 'extra' }, 'HTTP 500: {"reason":"unavailable"}'],
    [400, 'bad request', 'HTTP 400: bad request'],
    [200, { success: false, message: 'failed' }, 'HTTP 200: failed'],
    [200, { code: 403, error: 'forbidden' }, 'HTTP 200: forbidden'],
  ] as const) {
    mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status }));
    await assert.rejects(client.request('/test'), { message });
    mock.restoreAll();
  }
});

test('HTTP response mode preserves status and raw data without interpreting result fields', async () => {
  const client = new ApiClient('secret');
  const data = { success: false, code: 500, data: ['raw result'] };
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(data)));
  assert.deepEqual(await client.requestResponse('/test'), { status: 200, data });
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => new Response('{"taskId":"pending"}', { status: 201 }));
  assert.deepEqual(await client.requestResponse('/test'), { status: 201, data: { taskId: 'pending' } });
  assert.deepEqual(await client.request('/test'), { taskId: 'pending' });
});
