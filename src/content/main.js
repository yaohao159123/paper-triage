// Content-script entry: find papers/tweets on the page, ask the background for verdicts, paint badges,
// collapse skipped runs, optionally sort 关注 first.
import { pickAdapter } from './adapters/index.js';
import { normalizePaper } from '../shared/paper.js';
import { effectiveLabel, nextManualLabel, LABELS } from '../shared/policy.js';
import { reasonLabels } from '../shared/questions.js';
import { DEFAULT_DISPLAY } from '../shared/profile.js';
import { renderBadge, setDisabled, setSkipMode, countLabels, BADGE_CLASS } from './render.js';
import { mountToolbar, jumpToNextFollow } from './toolbar.js';
import { refreshRuns, toggleExpanded } from './collapse.js';
import { reorder } from './reorder.js';

const adapter = pickAdapter(location);
const byKey = new Map(); // key -> [{entry, verdict}]
const LABELS_FOR_REASONS = adapter ? reasonLabels(adapter.domain || 'paper') : {};
let display = { ...DEFAULT_DISPLAY };
let toolbar = null;
let timer = null;
let scanning = false;
let queued = null;
let nextIndex = 0;

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
  document.documentElement.classList.add(`pt-site-${adapter.id}`);
  const settings = await send({ type: 'getSettings' });
  applyDisplay(settings.ok ? settings.display : null);
  setDisabled(document, settings.ok && settings.enabled === false);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const prev = changes.settings.oldValue || {};
    const next = changes.settings.newValue || {};
    setDisabled(document, next.enabled === false);
    if (JSON.stringify(next.display) !== JSON.stringify(prev.display)) applyDisplay(next.display);
    const profileChanged = adapter.domain === 'tweet'
      ? JSON.stringify(next.tweetProfile) !== JSON.stringify(prev.tweetProfile)
      : next.activeProfileId !== prev.activeProfileId || JSON.stringify(next.profiles) !== JSON.stringify(prev.profiles);
    if (profileChanged) scan({ all: true });
  });
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg?.type === 'rerun') { scan({ all: true, force: true }).then(() => reply({ ok: true })); return true; }
    if (msg?.type === 'export') { reply({ ok: true, ...exportEntries(msg.labels || ['follow']) }); return false; }
    if (msg?.type === 'filter') { toolbar?.setFollowOnly(msg.mode === 'follow'); reply({ ok: true }); return false; }
    return false;
  });
  document.addEventListener('click', onBadgeClick, true);
  document.addEventListener('dblclick', onDoubleClick, true);
  document.addEventListener('keydown', onKey);
  await scan();
  new MutationObserver((muts) => {
    const relevant = muts.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && !n.closest?.(`.${BADGE_CLASS}, .pt-toolbar, .pt-review, .pt-reasons, .pt-run`)));
    if (relevant) {
      clearTimeout(timer);
      timer = setTimeout(() => scan(), 600);
    }
  }).observe(document.body, { childList: true, subtree: true });
}

/** Apply a display change locally right away, then persist it (other tabs pick it up via storage.onChanged). */
function setDisplay(patch) {
  const next = { ...display, ...patch };
  if (JSON.stringify(next) === JSON.stringify(display)) return;
  applyDisplay(next);
  send({ type: 'setSettings', patch: { display: next } });
}

function applyDisplay(d) {
  display = { ...DEFAULT_DISPLAY, ...(d || {}) };
  setSkipMode(document, display.skipMode);
  document.documentElement.classList.toggle('pt-no-accent', display.followAccent === false);
  toolbar?.setSkipMode(display.skipMode);
  if (toolbar && toolbar.getSort() !== !!display.sortFollowFirst) toolbar.setSort(!!display.sortFollowFirst);
  afterLayout();
}

/** all: re-request every entry (cache still applies); force: bypass cache; only: one key. */
async function scan(opts = {}) {
  if (scanning) { queued = { ...(queued || {}), ...opts }; return; }
  scanning = true;
  try {
    const { force = false, only = null, all = false } = opts;
    const entries = [];
    for (const e of adapter.findEntries(document)) {
      const paper = normalizePaper(e.paper);
      if (!paper.title) continue;
      const already = e.containers[0].dataset.ptKey;
      if (only ? paper.key !== only : already && !force && !all) continue;
      e.paper = paper;
      e.key = paper.key;
      e.badgeAfter = e.mount.querySelector(':scope > .descriptor');
      for (const c of e.containers) c.dataset.ptKey = paper.key;
      entries.push(e);
    }
    if (!entries.length) return;
    if (!toolbar && entries.some((e) => !e.single)) {
      toolbar = mountToolbar(document, {
        onRerun: () => scan({ all: true, force: true }),
        onSkipMode: (mode) => setDisplay({ skipMode: mode }),
        onFollowOnly: () => afterLayout(),
        onSort: (on) => setDisplay({ sortFollowFirst: on }),
      }, { skipMode: display.skipMode, sortFollowFirst: display.sortFollowFirst, sortable: adapter.domain !== 'tweet' });
    }
    for (const e of entries) {
      renderBadge(e, { state: 'loading' });
      register(e);
    }
    refreshToolbar();
    const res = await send({ type: 'triage', domain: adapter.domain || 'paper', items: entries.map((e) => e.paper), force });
    apply(res, entries);
  } finally {
    scanning = false;
    if (queued) { const q = queued; queued = null; scan(q); }
  }
}

function register(entry) {
  const list = byKey.get(entry.key) || [];
  if (!list.some((r) => r.entry === entry)) {
    entry.originalIndex = nextIndex++;
    list.push({ entry, verdict: null });
  }
  byKey.set(entry.key, list);
}

function apply(res, entries) {
  const errorFor = new Map();
  for (const err of res.errors || []) for (const k of err.keys || []) errorFor.set(k, err.message);
  for (const e of entries) {
    const v = res.ok ? res.verdicts?.[e.key] : null;
    if (v) {
      for (const r of byKey.get(e.key) || []) r.verdict = v;
      renderBadge(e, { state: 'verdict', verdict: v, reasonLabels: display.reasons === false ? null : LABELS_FOR_REASONS });
    } else {
      renderBadge(e, { state: 'error', message: errorFor.get(e.key) || res.error?.message || '未知错误' });
    }
  }
  afterLayout();
}

/** Entries currently in the document, in DOM order, with their effective labels. */
function liveEntries() {
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('[data-pt-key]')) {
    const key = el.dataset.ptKey;
    if (!key || seen.has(key)) continue;
    const rec = (byKey.get(key) || []).find((r) => r.entry.containers[0] === el) || (byKey.get(key) || [])[0];
    if (!rec || !rec.entry.containers[0].isConnected) continue;
    seen.add(key);
    out.push({ key, containers: rec.entry.containers, label: effectiveLabel(rec.verdict), originalIndex: rec.entry.originalIndex, single: rec.entry.single });
  }
  return out;
}

/** Re-sort (if on), rebuild collapsed-run markers, refresh counts. */
function afterLayout() {
  const entries = liveEntries().filter((e) => !e.single);
  if (adapter.domain !== 'tweet' && entries.length) reorder(entries, display.sortFollowFirst ? 'follow-first' : 'original');
  if (display.skipMode === 'collapse') refreshRuns(document, liveEntries().filter((e) => !e.single));
  else refreshRuns(document, []);
  refreshToolbar();
}

function refreshToolbar() {
  toolbar?.update(countLabels(document));
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
  const res = await send({ type: 'override', key, manual, domain: adapter.domain || 'paper' });
  const next = res.ok ? { ...current, ...res, manual: res.manual ?? manual } : { ...current, manual };
  delete next.ok;
  for (const r of records) {
    r.verdict = next;
    renderBadge(r.entry, { state: 'verdict', verdict: next, reasonLabels: display.reasons === false ? null : LABELS_FOR_REASONS });
  }
  afterLayout();
}

function onDoubleClick(event) {
  if (event.target?.closest?.('a, button, input, textarea, .pt-toolbar')) return;
  const container = event.target?.closest?.('[data-pt-key].pt-skipped');
  if (!container || display.skipMode !== 'collapse') return;
  const rec = (byKey.get(container.dataset.ptKey) || [])[0];
  if (!rec) return;
  event.preventDefault();
  toggleExpanded(rec.entry);
}

function onKey(e) {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
  if (e.key === 'Enter' || e.key === ' ') {
    if (e.target?.classList?.contains(BADGE_CLASS)) { e.preventDefault(); onBadgeClick(e); }
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'n') { e.preventDefault(); jumpToNextFollow(document); }
  else if (k === 'f' && toolbar) { e.preventDefault(); toolbar.setFollowOnly(!toolbar.getFollowOnly()); }
  else if (k === 's' && toolbar && adapter.domain !== 'tweet') { e.preventDefault(); toolbar.setSort(!toolbar.getSort()); }
  else if (k === 'h' && toolbar) { e.preventDefault(); setDisplay({ skipMode: display.skipMode === 'hide' ? 'collapse' : 'hide' }); }
}

/** Markdown list of the page's papers whose effective label is in `labels`, in page order. */
export function exportEntries(labels) {
  const want = new Set(labels);
  const lines = [];
  const seen = new Set();
  for (const [key, records] of byKey) {
    if (seen.has(key)) continue;
    const { entry, verdict } = records[0];
    const label = effectiveLabel(verdict);
    if (!verdict || !want.has(label)) continue;
    seen.add(key);
    const p = entry.paper;
    const meta = [p.authors, [p.venue, p.year].filter(Boolean).join(', ')].filter(Boolean).join('. ');
    lines.push(`- [${LABELS[label].zh}] **${p.title}**${meta ? `. ${meta}` : ''}${p.url ? ` <${p.url}>` : ''}${p.doi ? ` doi:${p.doi}` : ''}`);
  }
  return { count: lines.length, markdown: lines.join('\n') };
}
