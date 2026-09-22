// Service worker: owns the API key, talks to Jev, keeps the verdict cache.
import { askJev, pingJev, JevError } from './shared/jev.js';
import { buildTriageState, buildTriageQuestions } from './shared/questions.js';
import { verdictFromAnswers } from './shared/policy.js';
import { chunk, normalizePaper } from './shared/paper.js';
import { DEFAULT_PROFILE, DEFAULT_THRESHOLDS, DEFAULT_BATCH_SIZE, DEFAULT_MODEL_NAME } from './shared/profile.js';

const SETTINGS_KEY = 'settings';
const CACHE_PREFIX = 'v:';

export async function getSettings() {
  const { [SETTINGS_KEY]: s } = await chrome.storage.local.get(SETTINGS_KEY);
  return {
    apiKey: '',
    model: DEFAULT_MODEL_NAME,
    enabled: true,
    profile: DEFAULT_PROFILE,
    thresholds: DEFAULT_THRESHOLDS,
    batchSize: DEFAULT_BATCH_SIZE,
    ...(s || {}),
  };
}

async function setSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

async function readCache(keys) {
  const got = await chrome.storage.local.get(keys.map((k) => CACHE_PREFIX + k));
  const out = {};
  for (const k of keys) if (got[CACHE_PREFIX + k]) out[k] = got[CACHE_PREFIX + k];
  return out;
}

async function writeCache(map) {
  const payload = {};
  for (const [k, v] of Object.entries(map)) payload[CACHE_PREFIX + k] = v;
  if (Object.keys(payload).length) await chrome.storage.local.set(payload);
}

function describeError(err) {
  if (err instanceof JevError) {
    if (err.status === 401 || err.status === 403) return { code: 'auth', status: err.status, message: 'API Key 无效或无权限，请在扩展设置里检查。' };
    if (err.status === 429) return { code: 'rate', status: 429, message: 'Jev 请求过于频繁（429），稍后重试。' };
    if (err.status >= 500) return { code: 'server', status: err.status, message: `Jev 服务端错误（${err.status}），稍后重试。` };
    return { code: 'http', status: err.status, message: err.message };
  }
  return { code: 'network', status: 0, message: `无法连接 Jev：${err?.message || err}` };
}

/** Judge the given papers; cached verdicts are reused unless force. Manual overrides always survive. */
export async function triage(rawPapers, { force = false } = {}) {
  const settings = await getSettings();
  const papers = [];
  const seen = new Set();
  for (const raw of rawPapers) {
    const p = normalizePaper(raw);
    if (!p.title || seen.has(p.key)) continue;
    seen.add(p.key);
    papers.push(p);
  }
  const cached = await readCache(papers.map((p) => p.key));
  const verdicts = {};
  const todo = [];
  for (const p of papers) {
    const c = cached[p.key];
    if (c && c.label && !force) verdicts[p.key] = c;
    else todo.push(p);
  }
  const errors = [];
  if (todo.length) {
    if (!settings.apiKey) {
      errors.push({ keys: todo.map((p) => p.key), ...{ code: 'no_api_key', status: 0, message: '未设置 TypeSafe API Key，请打开扩展设置。' } });
      return { verdicts, errors };
    }
    const batches = chunk(todo, Math.max(1, Math.min(20, Number(settings.batchSize) || DEFAULT_BATCH_SIZE)));
    const results = await Promise.allSettled(
      batches.map(async (batch) => {
        const state = buildTriageState(settings.profile, batch);
        const questions = buildTriageQuestions(batch.length);
        const res = await askJev({ apiKey: settings.apiKey, model: settings.model || DEFAULT_MODEL_NAME }, state, questions);
        const out = {};
        batch.forEach((p, i) => {
          const v = verdictFromAnswers(res.answers, i, settings.thresholds, { model: res.model, ts: Date.now() });
          v.manual = cached[p.key]?.manual || null;
          v.title = p.title;
          out[p.key] = v;
        });
        return out;
      }),
    );
    const fresh = {};
    results.forEach((r, bi) => {
      if (r.status === 'fulfilled') Object.assign(fresh, r.value);
      else errors.push({ keys: batches[bi].map((p) => p.key), ...describeError(r.reason) });
    });
    await writeCache(fresh);
    Object.assign(verdicts, fresh);
  }
  return { verdicts, errors };
}

async function override(key, manual) {
  const [existing] = Object.values(await readCache([key]));
  const next = { ...(existing || { label: null, probs: null }), manual: manual || null };
  await writeCache({ [key]: next });
  return next;
}

async function clearCache() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
  return { removed: keys.length };
}

async function stats() {
  const all = await chrome.storage.local.get(null);
  const counts = { total: 0, follow: 0, normal: 0, skip: 0, manual: 0 };
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith(CACHE_PREFIX)) continue;
    counts.total += 1;
    const label = v.manual || v.label;
    if (label in counts) counts[label] += 1;
    if (v.manual) counts.manual += 1;
  }
  return counts;
}

const handlers = {
  triage: (m) => triage(m.papers || [], { force: !!m.force }),
  override: (m) => override(m.key, m.manual),
  getSettings: () => getSettings(),
  setSettings: (m) => setSettings(m.patch || {}),
  clearCache: () => clearCache(),
  stats: () => stats(),
  ping: async (m) => {
    const key = m.apiKey || (await getSettings()).apiKey;
    if (!key) return { ok: false, message: '未填写 API Key' };
    try {
      const models = await pingJev(key);
      return { ok: true, models };
    } catch (err) {
      return { ok: false, ...describeError(err) };
    }
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  h(msg)
    .then((r) => sendResponse({ ok: true, ...r }))
    .catch((err) => sendResponse({ ok: false, error: describeError(err) }));
  return true; // keep the channel open for the async reply
});
