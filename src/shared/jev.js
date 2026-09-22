// Minimal TypeSafe System One (Jev) client. Pure functions + one fetch wrapper.
// Mirrors the request/response contract at https://docs.typesafe.ai/api

export const SYSTEM_ONE_URL = 'https://api.typesafe.ai/v1/systemone';
export const MODELS_URL = 'https://api.typesafe.ai/v1/models';
export const DEFAULT_MODEL = 'jev-latest';

export function buildJevRequest({ apiKey, model = DEFAULT_MODEL, url = SYSTEM_ONE_URL }, state, questions) {
  if (!apiKey) throw new Error('missing_api_key');
  return {
    url,
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, state, questions }),
  };
}

export class JevError extends Error {
  constructor(message, { status = 0, retryAfterMs = 0 } = {}) {
    super(message);
    this.name = 'JevError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function parseJevResponse(status, ok, text, retryAfterHeader = null) {
  if (!ok) {
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 0;
    throw new JevError(`Jev HTTP ${status}: ${String(text).slice(0, 200)}`, { status, retryAfterMs });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new JevError('Jev returned malformed JSON');
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.answers || typeof parsed.answers !== 'object') {
    throw new JevError('Jev response is missing answers');
  }
  return parsed;
}

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** POST one state + questions map; retries 429/5xx with backoff (honours retry-after). */
export async function askJev(params, state, questions, { fetchImpl = globalThis.fetch, retries = 2, sleep = defaultSleep } = {}) {
  const req = buildJevRequest(params, state, questions);
  let attempt = 0;
  for (;;) {
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body });
    const text = await res.text();
    try {
      return parseJevResponse(res.status, res.ok, text, res.headers?.get?.('retry-after'));
    } catch (err) {
      if (err instanceof JevError && RETRYABLE.has(err.status) && attempt < retries) {
        attempt += 1;
        await sleep(err.retryAfterMs || 400 * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
}

/** GET /v1/models with the key; resolves to the list, throws JevError on auth failure. */
export async function pingJev(apiKey, { fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(MODELS_URL, { headers: { authorization: `Bearer ${apiKey}` } });
  const text = await res.text();
  if (!res.ok) throw new JevError(`Jev HTTP ${res.status}: ${text.slice(0, 200)}`, { status: res.status });
  return JSON.parse(text);
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
