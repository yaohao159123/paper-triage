// Content-script entry: find papers on the page, ask the background for verdicts, paint badges.
import { pickAdapter } from './adapters/index.js';
import { normalizePaper } from '../shared/paper.js';
import { effectiveLabel, nextManualLabel } from '../shared/policy.js';
import { renderBadge, setDisabled, BADGE_CLASS } from './render.js';

const adapter = pickAdapter(location);
const byKey = new Map(); // key -> [{entry, verdict}]
let timer = null;
let scanning = false;

if (adapter) start();

function send(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: { message: chrome.runtime.lastError.message } });
        else resolve(res || { ok: false, error: { message: 'no response' } });
      });
    } catch (err) {
      resolve({ ok: false, error: { message: String(err) } });
    }
  });
}

async function start() {
  const settings = await send({ type: 'getSettings' });
  setDisabled(document, settings.ok && settings.enabled === false);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) setDisabled(document, changes.settings.newValue?.enabled === false);
  });
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg?.type === 'rerun') {
      scan({ force: true }).then(() => reply({ ok: true }));
      return true;
    }
    return false;
  });
  document.addEventListener('click', onBadgeClick, true);
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target?.classList?.contains(BADGE_CLASS)) {
      e.preventDefault();
      onBadgeClick(e);
    }
  });
  await scan();
  new MutationObserver((muts) => {
    const relevant = muts.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && !n.classList?.contains(BADGE_CLASS)));
    if (relevant) {
      clearTimeout(timer);
      timer = setTimeout(() => scan(), 600);
    }
  }).observe(document.body, { childList: true, subtree: true });
}

async function scan({ force = false, only = null } = {}) {
  if (scanning) return;
  scanning = true;
  try {
    const entries = [];
    for (const e of adapter.findEntries(document)) {
      const paper = normalizePaper(e.paper);
      if (!paper.title) continue;
      const already = e.containers[0].dataset.ptKey;
      if (only ? paper.key !== only : already && !force) continue;
      e.paper = paper;
      e.key = paper.key;
      e.badgeAfter = e.mount.querySelector(':scope > .descriptor');
      for (const c of e.containers) c.dataset.ptKey = paper.key;
      entries.push(e);
    }
    if (!entries.length) return;
    for (const e of entries) {
      renderBadge(e, { state: 'loading' });
      register(e);
    }
    const res = await send({ type: 'triage', papers: entries.map((e) => e.paper), force });
    apply(res, entries);
  } finally {
    scanning = false;
  }
}

function register(entry) {
  const list = byKey.get(entry.key) || [];
  if (!list.some((r) => r.entry === entry)) list.push({ entry, verdict: null });
  byKey.set(entry.key, list);
}

function apply(res, entries) {
  const errorFor = new Map();
  for (const err of res.errors || []) for (const k of err.keys || []) errorFor.set(k, err.message);
  for (const e of entries) {
    const v = res.ok ? res.verdicts?.[e.key] : null;
    if (v) {
      for (const r of byKey.get(e.key) || []) r.verdict = v;
      renderBadge(e, { state: 'verdict', verdict: v });
    } else {
      renderBadge(e, { state: 'error', message: errorFor.get(e.key) || res.error?.message || '未知错误' });
    }
  }
}

async function onBadgeClick(event) {
  const badge = event.target?.closest?.(`.${BADGE_CLASS}`);
  if (!badge) return;
  event.preventDefault();
  event.stopPropagation();
  const container = badge.closest('[data-pt-key]');
  const key = container?.dataset.ptKey;
  const records = key ? byKey.get(key) : null;
  if (!records?.length) return;
  if (badge.dataset.ptState === 'error') {
    for (const r of records) r.entry.containers[0].dataset.ptKey = '';
    await scan({ only: key, force: true });
    return;
  }
  if (badge.dataset.ptState !== 'verdict') return;
  const current = records[0].verdict;
  const manual = event.altKey ? null : nextManualLabel(effectiveLabel(current));
  const res = await send({ type: 'override', key, manual });
  const next = res.ok ? { ...current, ...res, manual: res.manual ?? manual } : { ...current, manual };
  delete next.ok;
  for (const r of records) {
    r.verdict = next;
    renderBadge(r.entry, { state: 'verdict', verdict: next });
  }
}
