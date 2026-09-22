import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJevRequest, parseJevResponse, askJev, JevError, SYSTEM_ONE_URL } from '../src/shared/jev.js';

test('buildJevRequest shapes the HTTP request per the API reference', () => {
  const r = buildJevRequest({ apiKey: 'k' }, { a: 1 }, { q: { type: 'noul', instructions: 'x' } });
  assert.equal(r.url, SYSTEM_ONE_URL);
  assert.equal(r.headers.authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(r.body), { model: 'jev-latest', state: { a: 1 }, questions: { q: { type: 'noul', instructions: 'x' } } });
  assert.throws(() => buildJevRequest({ apiKey: '' }, {}, {}), /missing_api_key/);
});

test('parseJevResponse validates', () => {
  assert.throws(() => parseJevResponse(401, false, 'nope'), (e) => e instanceof JevError && e.status === 401);
  assert.throws(() => parseJevResponse(200, true, '{'), /malformed/);
  assert.throws(() => parseJevResponse(200, true, '{}'), /missing answers/);
  assert.deepEqual(parseJevResponse(200, true, '{"answers":{}}'), { answers: {} });
});

test('askJev retries 429 with retry-after then succeeds', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(init);
    if (calls.length === 1) return { status: 429, ok: false, headers: { get: () => '0' }, text: async () => 'slow down' };
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => '{"answers":{"q":{"noul":0.9}}}' };
  };
  const slept = [];
  const res = await askJev({ apiKey: 'k' }, 's', { q: { type: 'noul', instructions: 'x' } }, { fetchImpl, sleep: async (ms) => slept.push(ms) });
  assert.equal(res.answers.q.noul, 0.9);
  assert.equal(calls.length, 2);
  assert.equal(slept.length, 1);
});

test('askJev does not retry 401', async () => {
  let n = 0;
  const fetchImpl = async () => { n += 1; return { status: 401, ok: false, headers: { get: () => null }, text: async () => 'bad key' }; };
  await assert.rejects(askJev({ apiKey: 'k' }, 's', {}, { fetchImpl, sleep: async () => {} }), (e) => e.status === 401);
  assert.equal(n, 1);
});
