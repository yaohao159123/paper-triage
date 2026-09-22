// Service worker: owns the API key, talks to Jev, keeps the verdict cache.
import { askJev, pingJev, JevError } from './shared/jev.js';
import { DOMAINS } from './shared/questions.js';
import { verdictFromAnswers } from './shared/policy.js';
import { chunk, normalizePaper, basisOf, BASIS_RANK } from './shared/paper.js';
import { DEFAULT_THRESHOLDS, DEFAULT_BATCH_SIZE, DEFAULT_MODEL_NAME, DEFAULT_TWEET_PROFILE, ensureProfiles, activeProfile, profileHash, tweetProfileHash } from './shared/profile.js';

const SETTINGS_KEY = 'settings';
const CACHE_PREFIX = 'v:';

export async function getSettings() {
  const { [SETTINGS_KEY]: s } = await chrome.storage.local.get(SETTINGS_KEY);
  const merged = {
    apiKey: '',
    model: DEFAULT_MODEL_NAME,
    enabled: true,
    thresholds: DEFAULT_THRESHOLDS,
    batchSize: DEFAULT_BATCH_SIZE,
    ...(s || {}),
  };
  const { profiles, activeProfileId } = ensureProfiles(merged);
  merged.profiles = profiles;
  merged.activeProfileId = activeProfileId;
  merged.profile = activeProfile(merged); // the paper profile judgments use
  merged.tweetProfile = { ...DEFAULT_TWEET_PROFILE, ...(merged.tweetProfile || {}) };
  return merged;
}

async function setSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  delete next.profile; // derived from profiles + activeProfileId
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return getSettings();
}

const cacheKey = (ns, key) => `${CACHE_PREFIX}${ns}:${key}`;

async function readCache(ns, keys) {
  const got = await chrome.storage.local.get(keys.map((k) => cacheKey(ns, k)));
  const out = {};
  for (const k of keys) if (got[cacheKey(ns, k)]) out[k] = got[cacheKey(ns, k)];
  return out;
}

async function writeCache(ns, map) {
  const payload = {};
  for (const [k, v] of Object.entries(map)) payload[cacheKey(ns, k)] = v;
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

/** Judge the given items (papers or tweets); cached verdicts are reused unless force. Manual overrides always survive. */
export async function triage(rawPapers, { force = false, domain = 'paper' } = {}) {
  const settings = await getSettings();
  const dom = DOMAINS[domain] || DOMAINS.paper;
  const profile = domain === 'tweet' ? settings.tweetProfile : settings.profile;
  const papers = [];
  const seen = new Set();
  for (const raw of rawPapers) {
    const p = normalizePaper(raw);
    if (!p.title || seen.has(p.key)) continue;
    seen.add(p.key);
    papers.push(p);
  }
  const ns = domain === 'tweet' ? tweetProfileHash(profile) : profileHash(profile);
  const cached = await readCache(ns, papers.map((p) => p.key));
  const verdicts = {};
  const todo = [];
  for (const p of papers) {
    const c = cached[p.key];
    const upgrade = c && BASIS_RANK[basisOf(p)] > (BASIS_RANK[c.basis] ?? 0); // a full abstract beats a snippet verdict
    if (c && c.label && !force && !upgrade) verdicts[p.key] = c;
    else todo.push(p);
  }
  const errors = [];
  if (todo.length) {
    if (!settings.apiKey) {
      errors.push({ keys: todo.map((p) => p.key), ...{ code: 'no_api_key', status: 0, message: '未设置 TypeSafe API Key，请打开扩展设置。' } });
      return { verdicts, errors, profileHash: ns };
    }
    const batches = chunk(todo, Math.max(1, Math.min(20, Number(settings.batchSize) || DEFAULT_BATCH_SIZE)));
    const results = await Promise.allSettled(
      batches.map(async (batch) => {
        const state = dom.buildState(profile, batch);
        const questions = dom.buildQuestions(batch.length);
        const res = await askJev({ apiKey: settings.apiKey, model: settings.model || DEFAULT_MODEL_NAME }, state, questions);
        const out = {};
        batch.forEach((p, i) => {
          const v = verdictFromAnswers(res.answers, i, settings.thresholds, { model: res.model, ts: Date.now() });
          v.manual = cached[p.key]?.manual || null;
          v.title = p.title;
          v.basis = basisOf(p);
          v.domain = domain;
          v.chip = dom.chip;
          v.chipTitle = dom.chipTitle;
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
    await writeCache(ns, fresh);
    Object.assign(verdicts, fresh);
  }
  return { verdicts, errors, profileHash: ns };
}

async function override(key, manual, domain = 'paper') {
  const settings = await getSettings();
  const ns = domain === 'tweet' ? tweetProfileHash(settings.tweetProfile) : profileHash(settings.profile);
  const [existing] = Object.values(await readCache(ns, [key]));
  const next = { ...(existing || { label: null, probs: null }), manual: manual || null };
  await writeCache(ns, { [key]: next });
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
  const prefix = `${CACHE_PREFIX}${profileHash((await getSettings()).profile)}:`;
  const counts = { total: 0, follow: 0, normal: 0, skip: 0, manual: 0 };
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith(prefix)) continue;
    counts.total += 1;
    const label = v.manual || v.label;
    if (label in counts) counts[label] += 1;
    if (v.manual) counts.manual += 1;
  }
  return counts;
}

const handlers = {
  triage: (m) => triage(m.items || m.papers || [], { force: !!m.force, domain: m.domain || 'paper' }),
  override: (m) => override(m.key, m.manual, m.domain || 'paper'),
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

export function handleMessage(msg) {
  const h = handlers[msg?.type];
  if (!h) return null;
  return h(msg)
    .then((r) => ({ ok: true, ...r }))
    .catch((err) => ({ ok: false, error: describeError(err) }));
}

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const p = handleMessage(msg);
    if (!p) return false;
    p.then(sendResponse);
    return true; // keep the channel open for the async reply
  });
}
