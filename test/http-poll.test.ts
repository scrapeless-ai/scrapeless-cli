import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { ApiClient } from '../src/http.js';
import { merge } from '../src/data.js';
import { poll } from '../src/poll.js';

afterEach(() => mock.restoreAll());

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
