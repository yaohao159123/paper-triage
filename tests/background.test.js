import test from 'node:test';
import assert from 'node:assert/strict';

// In-memory chrome.storage.local so the service worker module can be exercised in node.
const store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys === null) return Object.fromEntries(store);
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((k) => store.has(k)).map((k) => [k, store.get(k)]));
      },
      async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, structuredClone(v)); },
      async remove(keys) { for (const k of keys) store.delete(k); },
    },
  },
};
const { triage, handleMessage, getSettings } = await import('../src/background.js');

let calls = [];
function fakeFetch(answersFor) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const answers = {};
    (body.state.papers || body.state.tweets).forEach((p, i) => {
      const a = answersFor({ title: p.title || p.text || '', abstract_or_snippet: p.abstract_or_snippet || p.text || '' }, i);
      answers[`paper_${i}_priority`] = { type: 'score', score: 0, confidence: 1, probabilities: a };
      answers[`paper_${i}_review`] = { type: 'noul', noul: 0.1 };
    });
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ model: 'jev-test', answers }) };
  };
}
const FOLLOW = { 0: 0.05, 1: 0.15, 2: 0.8 };
const SKIP = { 0: 0.9, 1: 0.05, 2: 0.05 };

test('without an API key every paper comes back as a no_api_key error', async () => {
  store.clear();
  const r = await triage([{ title: 'A' }]);
  assert.deepEqual(Object.keys(r.verdicts), []);
  assert.equal(r.errors[0].code, 'no_api_key');
});

test('triage judges, caches per profile hash, reuses cache, and force re-judges while keeping manual', async () => {
  store.clear();
  calls = [];
  globalThis.fetch = fakeFetch((p) => (p.title.includes('biomass') ? FOLLOW : SKIP));
  await handleMessage({ type: 'setSettings', patch: { apiKey: 'k' } });
  const papers = [{ title: 'Microwave heating of biomass' }, { title: 'Antenna design' }];
  const r1 = await triage(papers);
  assert.equal(calls.length, 1);
  assert.equal(r1.verdicts['title:microwave-heating-of-biomass'].label, 'follow');
  assert.equal(r1.verdicts['title:antenna-design'].label, 'skip');
  assert.equal(r1.verdicts['title:antenna-design'].basis, 'title');
  assert.match(r1.profileHash, /^[0-9a-f]{8}-p\d+$/);
  // cache hit: no new request
  const r2 = await triage(papers);
  assert.equal(calls.length, 1);
  assert.equal(r2.verdicts['title:antenna-design'].label, 'skip');
  // manual override survives a forced re-judge
  await handleMessage({ type: 'override', key: 'title:antenna-design', manual: 'follow' });
  const r3 = await triage(papers, { force: true });
  assert.equal(calls.length, 2);
  assert.equal(r3.verdicts['title:antenna-design'].manual, 'follow');
  assert.equal(r3.verdicts['title:antenna-design'].label, 'skip');
  const st = await handleMessage({ type: 'stats' });
  assert.equal(st.total, 2);
  assert.equal(st.follow, 2); // manual override counts as follow
  assert.equal(st.manual, 1);
});

test('a full abstract upgrades a snippet/title verdict; a different profile uses a different namespace', async () => {
  store.clear();
  calls = [];
  globalThis.fetch = fakeFetch((p) => (p.abstract_or_snippet.length > 50 ? FOLLOW : SKIP));
  await handleMessage({ type: 'setSettings', patch: { apiKey: 'k' } });
  const key = 'title:dielectric-study';
  const r1 = await triage([{ title: 'Dielectric study', abstract: 'short' }]);
  assert.equal(r1.verdicts[key].basis, 'snippet');
  assert.equal(r1.verdicts[key].label, 'skip');
  const r2 = await triage([{ title: 'Dielectric study', abstract: 'x'.repeat(200), abstractFull: true }]);
  assert.equal(calls.length, 2, 'full abstract triggers a re-judge');
  assert.equal(r2.verdicts[key].basis, 'full');
  assert.equal(r2.verdicts[key].label, 'follow');
  const r3 = await triage([{ title: 'Dielectric study', abstract: 'short' }]);
  assert.equal(calls.length, 2, 'snippet does not downgrade a full verdict');
  assert.equal(r3.verdicts[key].basis, 'full');
  // switch profile -> fresh namespace -> new request
  const s = await getSettings();
  await handleMessage({ type: 'setSettings', patch: { profiles: [...s.profiles, { id: 'h2', name: '氢还原', summary: 'hydrogen ironmaking', core_topics: ['H2-DRI'] }], activeProfileId: 'h2' } });
  const r4 = await triage([{ title: 'Dielectric study', abstract: 'short' }]);
  assert.equal(calls.length, 3);
  assert.notEqual(r4.profileHash, r1.profileHash);
  assert.equal(calls[2].state.researcher.summary, 'hydrogen ironmaking');
  const cleared = await handleMessage({ type: 'clearCache' });
  assert.equal(cleared.removed, 2);
});

test('tweet domain uses the tweet profile, its own namespace and chip text', async () => {
  store.clear();
  calls = [];
  globalThis.fetch = fakeFetch(() => FOLLOW);
  await handleMessage({ type: 'setSettings', patch: { apiKey: 'k' } });
  const r = await handleMessage({ type: 'triage', domain: 'tweet', items: [{ title: 't', abstract: 'A useful tweet', tweetId: '42' }] });
  assert.ok(r.ok);
  assert.equal(calls[0].state.reader.summary.length > 10, true);
  assert.equal(calls[0].state.tweets[0].text, 'A useful tweet');
  assert.match(r.profileHash, /^t[0-9a-f]{8}-p\d+$/);
  const v = r.verdicts['tweet:42'];
  assert.equal(v.domain, 'tweet');
  assert.equal(v.chip, '推广');
  await handleMessage({ type: 'override', key: 'tweet:42', manual: 'skip', domain: 'tweet' });
  const r2 = await handleMessage({ type: 'triage', domain: 'tweet', items: [{ title: 't', abstract: 'A useful tweet', tweetId: '42' }] });
  assert.equal(calls.length, 1, 'cache hit in the tweet namespace');
  assert.equal(r2.verdicts['tweet:42'].manual, 'skip');
});

test('xhs domain uses the xhs profile and its own namespace', async () => {
  store.clear();
  calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const answers = {};
    body.state.posts.forEach((p, i) => { answers[`paper_${i}_priority`] = { probabilities: /Claude/.test(p.title) ? FOLLOW : SKIP }; answers[`paper_${i}_review`] = { noul: 0.2 }; });
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ model: 'jev-test', answers }) };
  };
  await handleMessage({ type: 'setSettings', patch: { apiKey: 'k' } });
  const r = await handleMessage({ type: 'triage', domain: 'xhs', items: [{ title: 'Claude Code 教程', postId: 'a1' }, { title: '穿搭', postId: 'a2' }] });
  assert.ok(r.ok);
  assert.match(r.profileHash, /^x[0-9a-f]{8}-p\d+$/);
  assert.ok(calls[0].state.reader.interests.length > 0);
  assert.equal(r.verdicts['xhs:a1'].label, 'follow');
  assert.equal(r.verdicts['xhs:a2'].label, 'skip');
  assert.equal(r.verdicts['xhs:a2'].chip, '广告');
});
