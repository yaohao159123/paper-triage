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
      if (msg.type === 'getSettings') return cb({ ok: true, enabled: true });
      if (msg.type === 'triage') {
        const verdicts = {};
        for (const p of msg.items) {
          const follow = /biomass/i.test(p.title);
          verdicts[p.key] = { label: follow ? 'follow' : 'skip', probs: follow ? { skip: 0.05, normal: 0.1, follow: 0.85 } : { skip: 0.9, normal: 0.05, follow: 0.05 }, reviewProb: 0.1, manual: null, basis: 'snippet', chip: '综述' };
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
  assert.equal(q('.pt-skipped'), skipCount, 'skipped entries greyed');
  assert.equal(q('.pt-toolbar'), 1);
  assert.match(document.querySelector('.pt-tb-counts').textContent, new RegExp(`关注 ${q('.pt-follow')} · 普通 0 · 跳过 ${skipCount}`));
  // filters via message (popup) and via toolbar button
  await dispatch({ type: 'filter', mode: 'hideskip' });
  assert.ok(document.documentElement.classList.contains('pt-filter-hideskip'));
  document.querySelector('.pt-toolbar [data-filter="follow"]').click();
  assert.ok(document.documentElement.classList.contains('pt-filter-follow'));
  document.querySelector('.pt-toolbar [data-filter="all"]').click();
  assert.equal(document.documentElement.className, '');
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
  // keyboard: Alt+H toggles hide-skip
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', altKey: true, bubbles: true }));
  assert.ok(document.documentElement.classList.contains('pt-filter-hideskip'));
  // rerun message re-triages every entry with force
  const before = sent.filter((m) => m.type === 'triage').length;
  await dispatch({ type: 'rerun' });
  await until(() => sent.filter((m) => m.type === 'triage').length === before + 1);
  assert.equal(sent.at(-1).force, true);
  assert.equal(sent.at(-1).items.length, 10);
});
