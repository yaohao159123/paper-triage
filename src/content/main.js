// Content-script entry: find papers/tweets on the page, ask the background for verdicts, paint badges,
// collapse skipped runs, optionally sort 关注 first.
import { pickAdapter } from './adapters/index.js';
import { normalizePaper } from '../shared/paper.js';
import { effectiveLabel, nextManualLabel, LABELS } from '../shared/policy.js';
import { reasonLabels } from '../shared/questions.js';
import { DEFAULT_DISPLAY, skipModeFor } from '../shared/profile.js';
import { relayoutMasonry, restoreMasonry, movedBySite } from './masonry.js';
import { renderBadge, setDisabled, setSkipMode, setRootFlag, countLabels, BADGE_CLASS } from './render.js';
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
  document.documentElement.dataset.ptSite = adapter.id;
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
    if (msg?.type === 'diag') { reply({ ok: true, diag: diagnostics() }); return false; }
    return false;
  });
  document.addEventListener('click', onBadgeClick, true);
  document.addEventListener('dblclick', onDoubleClick, true);
  document.addEventListener('keydown', onKey);
  await scan();
  let quickScheduled = false;
  new MutationObserver((muts) => {
    const relevant = muts.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && !n.closest?.(`.${BADGE_CLASS}, .pt-toolbar, .pt-review, .pt-reasons, .pt-run`)));
    if (!relevant) return;
    // Virtualised feeds (X, 小红书) re-mount items on scroll: re-apply known verdicts right away, no round trip.
    if (!quickScheduled) {
      quickScheduled = true;
      requestAnimationFrame(() => { quickScheduled = false; quickApply(); });
    }
    clearTimeout(timer);
    timer = setTimeout(() => scan(), 150);
  }).observe(document.body, { childList: true, subtree: true });
}

/** Re-render entries that re-appeared without our marks but whose verdict we already hold. */
function quickApply() {
  let touched = false;
  for (const e of adapter.findEntries(document)) {
    if (e.containers[0].dataset.ptKey) continue;
    const paper = normalizePaper(e.paper);
    const rec = (byKey.get(paper.key) || []).find((r) => r.verdict);
    if (!rec) continue;
    e.paper = paper;
    e.key = paper.key;
    e.badgeAfter = e.mount.querySelector(':scope > .descriptor');
    for (const c of e.containers) c.dataset.ptKey = paper.key;
    register(e);
    for (const r of byKey.get(e.key)) if (r.entry === e) r.verdict = rec.verdict;
    renderBadge(e, { state: 'verdict', verdict: rec.verdict, reasonLabels: display.reasons === false ? null : LABELS_FOR_REASONS });
    touched = true;
  }
  if (touched) afterLayout();
}

/** Apply a display change locally right away, then persist it (other tabs pick it up via storage.onChanged). */
function setDisplay(patch) {
  const next = { ...display, ...patch };
  if (JSON.stringify(next) === JSON.stringify(display)) return;
  applyDisplay(next);
  send({ type: 'setSettings', patch: { display: next } });
}

const siteSkipMode = () => skipModeFor(display, adapter.id, adapter.defaultSkipMode);

function applyDisplay(d) {
  display = { ...DEFAULT_DISPLAY, ...(d || {}) };
  setSkipMode(document, siteSkipMode());
  setRootFlag(document, 'ptNoAccent', display.followAccent === false);
  toolbar?.setSkipMode(siteSkipMode());
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
    if (!force && !only) {
      // entries whose verdict we already hold (re-mounted by a virtualised feed) need no round trip
      const fresh = [];
      for (const e of entries) {
        const rec = (byKey.get(e.key) || []).find((r) => r.verdict);
        if (rec && !all) {
          register(e);
          for (const r of byKey.get(e.key)) if (r.entry === e) r.verdict = rec.verdict;
          renderBadge(e, { state: 'verdict', verdict: rec.verdict, reasonLabels: display.reasons === false ? null : LABELS_FOR_REASONS });
        } else fresh.push(e);
      }
      entries.length = 0;
      entries.push(...fresh);
      if (!entries.length) { afterLayout(); return; }
    }
    if (!toolbar && entries.some((e) => !e.single)) {
      toolbar = mountToolbar(document, {
        onRerun: () => scan({ all: true, force: true }),
        onSkipMode: (mode) => setDisplay({ skipModes: { ...(display.skipModes || {}), [adapter.id]: mode } }),
        onFollowOnly: () => afterLayout(),
        onSort: (on) => setDisplay({ sortFollowFirst: on }),
      }, { skipMode: siteSkipMode(), sortFollowFirst: display.sortFollowFirst, sortable: (adapter.domain || 'paper') === 'paper' });
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
  if ((adapter.domain || 'paper') === 'paper' && entries.length) reorder(entries, display.sortFollowFirst ? 'follow-first' : 'original');
  if (siteSkipMode() === 'collapse' && !adapter.masonry) refreshRuns(document, liveEntries().filter((e) => !e.single));
  else refreshRuns(document, []);
  relayoutIfMasonry();
  refreshToolbar();
}

let masonryWatched = null;
let masonryTimer = null;
/** The site re-lays out on scroll-load, image load and resize without adding nodes: watch style writes it makes and re-run ours. */
function watchMasonry(container) {
  if (!adapter.masonry || masonryWatched === container) return;
  masonryWatched = container;
  const schedule = (reset) => {
    clearTimeout(masonryTimer);
    masonryTimer = setTimeout(() => relayoutIfMasonry({ resetColumns: reset }), 120);
  };
  new MutationObserver((muts) => {
    const foreign = muts.some((m) => m.target.matches?.(adapter.masonry.cards) && movedBySite(m.target));
    if (foreign) schedule(true);
  }).observe(container, { attributes: true, attributeFilter: ['style'], subtree: true });
  window.addEventListener('resize', () => schedule(true));
}

/** 小红书 feed: after hiding cards, re-place the remaining ones so the grid has no holes. */
function relayoutIfMasonry({ resetColumns = false } = {}) {
  if (!adapter.masonry) return;
  const container = document.querySelector(adapter.masonry.container);
  const cards = container ? [...container.querySelectorAll(adapter.masonry.cards)] : [];
  if (!cards.length) return;
  watchMasonry(container);
  const hiding = siteSkipMode() === 'hide' || !!document.documentElement.dataset.ptFollowOnly;
  if (hiding) relayoutMasonry(container, cards, { resetColumns });
  else restoreMasonry(container, cards);
}

/** Snapshot for the popup's 「复制诊断信息」: what this page looks like to the extension right now. */
function diagnostics() {
  const html = document.documentElement;
  const counts = countLabels(document);
  const out = { version: chrome.runtime.getManifest?.().version, url: location.href, site: adapter.id, domain: adapter.domain || 'paper', skipMode: siteSkipMode(), followOnly: !!html.dataset.ptFollowOnly, disabled: !!html.dataset.ptDisabled, counts, unmarked: adapter.findEntries(document).filter((e) => !e.containers[0].dataset.ptKey).length };
  if (adapter.masonry) {
    const container = document.querySelector(adapter.masonry.container);
    const cards = container ? [...container.querySelectorAll(adapter.masonry.cards)] : [];
    out.masonry = {
      container: container ? { style: container.getAttribute('style'), relayout: container.dataset.ptRelayout || null, cols: container.dataset.ptCols || null, gap: container.dataset.ptGap || null, height: Math.round(container.getBoundingClientRect().height) } : null,
      cards: cards.length,
      hidden: cards.filter((c) => getComputedStyle(c).display === 'none').length,
      sample: cards.slice(0, 4).map((c) => { const cs = getComputedStyle(c); const r = c.getBoundingClientRect(); return { key: c.dataset.ptKey || null, label: c.dataset.ptLabel || null, style: (c.getAttribute('style') || '').slice(0, 160), position: cs.position, transform: cs.transform, left: cs.left, top: cs.top, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }; }),
    };
  }
  return out;
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
  const container = event.target?.closest?.('[data-pt-key][data-pt-skipped]');
  if (!container || siteSkipMode() !== 'collapse') return;
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
  // Match the physical key: on macOS Option+F arrives as key "ƒ" (Option+N / Option+H as dead keys), never as "f".
  const k = e.code || `Key${e.key.toUpperCase()}`;
  if (k === 'KeyN') { e.preventDefault(); jumpToNextFollow(document); }
  else if (k === 'KeyF' && toolbar) { e.preventDefault(); toolbar.setFollowOnly(!toolbar.getFollowOnly()); }
  else if (k === 'KeyS' && toolbar && (adapter.domain || 'paper') === 'paper') { e.preventDefault(); toolbar.setSort(!toolbar.getSort()); }
  else if (k === 'KeyH' && toolbar) { e.preventDefault(); const next = siteSkipMode() === 'hide' ? 'collapse' : 'hide'; setDisplay({ skipModes: { ...(display.skipModes || {}), [adapter.id]: next } }); }
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
