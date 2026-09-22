import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// Integration: the real content script against the Scholar fixture with a fake chrome.* bridge.
const dom = new JSDOM(readFileSync(new URL('./fixtures/scholar.html', import.meta.url), 'utf8'), { url: 'https://scholar.google.com/scholar?q=microwave' });
const { window } = dom;
for (const k of ['document', 'location', 'MutationObserver', 'HTMLElement', 'Node', 'MouseEvent', 'KeyboardEvent', 'Event']) globalThis[k] = window[k];
globalThis.window = window;
window.HTMLElement.prototype.scrollIntoView = function () {};

const sent = [];
const listeners = [];
globalThis.chrome = {
  runtime: {
    lastError: null,
    getURL: (p) => p,
    onMessage: { addListener: (fn) => listeners.push(fn) },
    sendMessage(msg, cb) {
      sent.push(msg);
      if (msg.type === 'getSettings') return cb({ ok: true, enabled: true, display: { skipMode: 'collapse', reasons: true, followAccent: true, sortFollowFirst: false } });
      if (msg.type === 'setSettings') return cb({ ok: true });
      if (msg.type === 'triage') {
        const verdicts = {};
        for (const p of msg.items) {
          const follow = /oil palm|Malaysian|date palm|Australian/i.test(p.title); // 4 follows, the rest skipped in runs
          verdicts[p.key] = { label: follow ? 'follow' : 'skip', probs: follow ? { skip: 0.05, normal: 0.1, follow: 0.85 } : { skip: 0.9, normal: 0.05, follow: 0.05 }, reviewProb: 0.1, manual: null, basis: 'snippet', chip: '综述', reasons: follow ? { topic: 0.9, method: 0.3, material: 0.7 } : { topic: 0.1, method: 0.1, material: 0.1 } };
        }
        return cb({ ok: true, verdicts, errors: [] });
      }
      if (msg.type === 'override') return cb({ ok: true, manual: msg.manual });
      cb({ ok: false });
    },
  },
  storage: { onChanged: { addListener() {} } },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 3000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > timeout) throw new Error('timeout'); await sleep(20); } }
const q = (s) => document.querySelectorAll(s).length;
const dispatch = (msg) => new Promise((resolve) => { for (const l of listeners) l(msg, {}, resolve); });

test('content script: scan → verdict badges → toolbar counts → filters → export → click override', async () => {
  const { exportEntries } = await import('../src/content/main.js');
  await until(() => q('.pt-badge[data-pt-state="verdict"]') === 10);
  assert.equal(sent.find((m) => m.type === 'triage').domain, 'paper');
  assert.equal(sent.find((m) => m.type === 'triage').items.length, 10);
  const skipCount = q('.pt-skip');
  assert.ok(q('.pt-follow') >= 1 && skipCount >= 1, 'mixed labels');
  assert.equal(q('.pt-skipped'), skipCount, 'skipped entries marked');
  assert.equal(q('.pt-follow-item'), q('.pt-follow'), 'follow entries get the accent class');
  assert.ok(document.documentElement.classList.contains('pt-site-scholar'));
  assert.ok(document.documentElement.classList.contains('pt-skip-collapse'));
  assert.equal(q('.pt-reasons'), q('.pt-follow'), 'reasons shown for follow entries only');
  assert.equal(document.querySelector('.pt-follow-item .pt-reasons').textContent, '命中 课题 · 材料');
  assert.equal(q('.pt-toolbar'), 1);
  assert.match(document.querySelector('.pt-tb-counts').textContent, new RegExp(`关注 ${q('.pt-follow')} · 普通 0 · 跳过 ${skipCount}`));
  // collapsed runs: consecutive skipped results are grouped under a marker
  const runTotal = [...document.querySelectorAll('.pt-run')].reduce((n, m) => n + Number(m.dataset.ptCount), 0);
  assert.ok(q('.pt-run') >= 1 && runTotal <= skipCount, `runs ${q('.pt-run')} covering ${runTotal}`);
  // 只看关注 via popup message and via toolbar button
  await dispatch({ type: 'filter', mode: 'follow' });
  assert.ok(document.documentElement.classList.contains('pt-filter-follow'));
  document.querySelector('.pt-toolbar [data-action="followonly"]').click();
  assert.ok(!document.documentElement.classList.contains('pt-filter-follow'));
  // 关注置顶: follows move ahead of skips inside the results container, then restore
  const order = () => [...document.querySelectorAll('.gs_r[data-pt-key]')].map((el) => el.dataset.ptLabel);
  const beforeOrder = order();
  document.querySelector('.pt-toolbar [data-action="sort"]').click();
  const sorted = order();
  assert.equal(sorted.lastIndexOf('follow') < sorted.indexOf('skip'), true, `sorted: ${sorted.join(',')}`);
  document.querySelector('.pt-toolbar [data-action="sort"]').click();
  assert.deepEqual(order(), beforeOrder);
  // export follows only, markdown lines carry title + url
  const ex = exportEntries(['follow']);
  assert.equal(ex.count, q('.pt-follow'));
  assert.match(ex.markdown.split('\n')[0], /^- \[关注\] \*\*.+\*\*.*<https?:\/\/.+>/);
  const viaMsg = await dispatch({ type: 'export', labels: ['skip'] });
  assert.equal(viaMsg.count, skipCount);
  // click override: follow -> normal (manual), alt-click restores AI label
  const badge = document.querySelector('.pt-follow');
  badge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await until(() => badge.textContent === '普通');
  assert.ok(badge.classList.contains('pt-manual'));
  assert.equal(sent.at(-1).type, 'override');
  assert.equal(sent.at(-1).manual, 'normal');
  badge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }));
  await until(() => badge.textContent === '关注');
  assert.ok(!badge.classList.contains('pt-manual'));
  // keyboard: Alt+F toggles 只看关注, Alt+H asks the background to switch skip mode to hide
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', altKey: true, bubbles: true }));
  assert.ok(document.documentElement.classList.contains('pt-filter-follow'));
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', altKey: true, bubbles: true }));
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', altKey: true, bubbles: true }));
  const patch = sent.filter((m) => m.type === 'setSettings').at(-1);
  assert.equal(patch.patch.display.skipMode, 'hide');
  // rerun message re-triages every entry with force
  const before = sent.filter((m) => m.type === 'triage').length;
  await dispatch({ type: 'rerun' });
  await until(() => sent.filter((m) => m.type === 'triage').length === before + 1);
  assert.equal(sent.at(-1).force, true);
  assert.equal(sent.at(-1).items.length, 10);
});
