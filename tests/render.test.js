import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderBadge, countLabels, setSkipMode, REVIEW_CLASS, REASONS_CLASS } from '../src/content/render.js';
import { mountToolbar, jumpToNextFollow, setFollowOnly } from '../src/content/toolbar.js';
import { refreshRuns, toggleExpanded, RUN_CLASS } from '../src/content/collapse.js';
import { reorder } from '../src/content/reorder.js';
import { arxivAdapter } from '../src/content/adapters/arxiv.js';

const LABELS = { topic: '课题', method: '方法', material: '材料' };

function page() {
  const dom = new JSDOM('<!doctype html><body><dl><dt id="dt1"></dt><dd id="dd1"><div class="t"><span class="descriptor">Title:</span> A</div></dd><dt id="dt2"></dt><dd id="dd2"><div class="t">B</div></dd></dl></body>', { url: 'https://arxiv.org/list/x/new' });
  const doc = dom.window.document;
  const e1 = { containers: [doc.getElementById('dt1'), doc.getElementById('dd1')], mount: doc.querySelector('#dd1 .t'), badgeAfter: doc.querySelector('#dd1 .descriptor') };
  const e2 = { containers: [doc.getElementById('dt2'), doc.getElementById('dd2')], mount: doc.querySelector('#dd2 .t') };
  for (const [i, e] of [e1, e2].entries()) for (const c of e.containers) c.dataset.ptKey = `k${i}`;
  return { dom, doc, e1, e2 };
}

test('renderBadge: label attrs on all containers, review chip, reasons text, unsure dashes, follow accent, loading clears', () => {
  const { e1, e2 } = page();
  const badge = renderBadge(e1, { state: 'verdict', verdict: { label: 'skip', probs: { skip: 0.8, normal: 0.1, follow: 0.1 }, reviewProb: 0.9, basis: 'snippet', reasons: { topic: 0.9 } }, reasonLabels: LABELS });
  assert.equal(badge.textContent, '跳过');
  assert.equal(badge.previousElementSibling.className, 'descriptor', 'badge sits after the Title: descriptor');
  assert.equal(badge.nextElementSibling.className, REVIEW_CLASS);
  assert.equal(badge.parentNode.querySelector(`.${REASONS_CLASS}`), null, 'skipped entries never show reasons');
  assert.equal(e1.containers[0].dataset.ptLabel, 'skip');
  assert.equal(e1.containers[1].dataset.ptSkipped, '1');
  assert.match(badge.title, /摘要片段/);
  // follow with reasons + unsure
  renderBadge(e1, { state: 'verdict', verdict: { label: 'follow', unsure: true, probs: { skip: 0.3, normal: 0.2, follow: 0.5 }, reviewProb: 0.1, reasons: { topic: 0.9, method: 0.2, material: 0.6 } }, reasonLabels: LABELS });
  assert.equal(badge.textContent, '关注');
  assert.ok(badge.classList.contains('pt-unsure'));
  assert.equal(badge.nextElementSibling?.className, REASONS_CLASS, 'review chip removed, reasons follow the badge');
  assert.equal(badge.nextElementSibling.textContent, '命中 课题 · 材料');
  assert.match(badge.title, /把握不大/);
  assert.match(badge.title, /课题 90%/);
  assert.equal(e1.containers[1].dataset.ptAccent, '1');
  assert.equal(e1.containers[1].dataset.ptSkipped, undefined);
  // manual override hides the unsure hint
  renderBadge(e1, { state: 'verdict', verdict: { label: 'follow', unsure: true, manual: 'normal', probs: { skip: 0.3, normal: 0.2, follow: 0.5 } }, reasonLabels: LABELS });
  assert.ok(!badge.classList.contains('pt-unsure'));
  assert.ok(badge.classList.contains('pt-manual'));
  assert.equal(e1.containers[1].dataset.ptAccent, undefined);
  renderBadge(e1, { state: 'loading' });
  assert.equal(e1.containers[0].dataset.ptLabel, undefined);
  assert.equal(badge.parentNode.querySelector(`.${REASONS_CLASS}`), null);
  // noGray entries keep the label but get no accent/grey
  e2.noGray = true;
  renderBadge(e2, { state: 'verdict', verdict: { label: 'skip', probs: { skip: 1, normal: 0, follow: 0 } } });
  assert.equal(e2.containers[1].dataset.ptSkipped, undefined);
  assert.equal(e2.containers[1].dataset.ptLabel, 'skip');
});

test('countLabels counts unique keys (dt+dd once) and pending; setSkipMode toggles html classes', () => {
  const { doc, e1, e2 } = page();
  renderBadge(e1, { state: 'verdict', verdict: { label: 'follow', probs: { skip: 0, normal: 0, follow: 1 } } });
  renderBadge(e2, { state: 'loading' });
  assert.deepEqual(countLabels(doc), { follow: 1, normal: 0, skip: 0, pending: 1, error: 0, total: 2 });
  setSkipMode(doc, 'hide');
  assert.equal(doc.documentElement.dataset.ptSkip, 'hide');
  setSkipMode(doc, 'collapse');
  assert.equal(doc.documentElement.dataset.ptSkip, 'collapse');
});

test('toolbar: single instance, counts, skip-mode select, 只看关注 toggle, sort toggle, next jumps', () => {
  const { dom, doc, e1, e2 } = page();
  const scrolled = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.id); };
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 100 });
  const events = [];
  mountToolbar(doc, {});
  const bar = mountToolbar(doc, { onRerun: () => events.push('rerun'), onSkipMode: (m) => events.push(`mode:${m}`), onFollowOnly: (v) => events.push(`follow:${v}`), onSort: (v) => events.push(`sort:${v}`) }, { skipMode: 'dim', sortable: true });
  assert.equal(doc.querySelectorAll('.pt-toolbar').length, 1);
  bar.update({ follow: 2, normal: 3, skip: 4, pending: 0 });
  assert.match(doc.querySelector('.pt-tb-counts').textContent, /关注 2 · 普通 3 · 跳过 4/);
  const sel = bar.element.querySelector('.pt-tb-skipmode');
  assert.equal(sel.value, 'dim');
  sel.value = 'hide';
  sel.dispatchEvent(new dom.window.Event('change'));
  assert.deepEqual(events, ['mode:hide']);
  bar.element.querySelector('[data-action="followonly"]').click();
  assert.equal(doc.documentElement.dataset.ptFollowOnly, '1');
  assert.equal(dom.window.sessionStorage.getItem('pt-follow-only'), '1');
  bar.element.querySelector('[data-action="sort"]').click();
  assert.equal(bar.getSort(), true);
  assert.deepEqual(events.slice(1), ['follow:true', 'sort:true']);
  bar.element.querySelector('[data-action="rerun"]').click();
  assert.equal(events.at(-1), 'rerun');
  const noSort = mountToolbar(doc, {}, { sortable: false });
  assert.equal(noSort.element.querySelector('[data-action="sort"]'), null, 'tweet pages get no sort button');
  renderBadge(e2, { state: 'verdict', verdict: { label: 'follow', probs: { skip: 0, normal: 0, follow: 1 } } });
  renderBadge(e1, { state: 'verdict', verdict: { label: 'skip', probs: { skip: 1, normal: 0, follow: 0 } } });
  assert.equal(jumpToNextFollow(doc).id, 'dt2');
  assert.deepEqual(scrolled, ['dt2']);
  setFollowOnly(doc, false);
  assert.equal(doc.documentElement.dataset.ptFollowOnly, undefined);
});

test('collapse: runs of ≥2 skipped entries get one marker that expands/collapses them; single skips get none', () => {
  const dom = new JSDOM('<body><div id="a"></div><div id="b"></div><div id="c"></div><div id="d"></div><div id="e"></div></body>');
  const doc = dom.window.document;
  const mk = (id, label) => ({ key: id, containers: [doc.getElementById(id)], label });
  const entries = [mk('a', 'skip'), mk('b', 'skip'), mk('c', 'follow'), mk('d', 'skip'), mk('e', 'skip')];
  assert.equal(refreshRuns(doc, entries), 2);
  const markers = doc.querySelectorAll(`.${RUN_CLASS}`);
  assert.equal(markers.length, 2);
  assert.equal(markers[0].nextElementSibling.id, 'a');
  assert.match(markers[0].textContent, /已折叠 2 条/);
  markers[0].click();
  assert.ok(doc.getElementById('a').dataset.ptExpanded && doc.getElementById('b').dataset.ptExpanded);
  assert.equal(doc.getElementById('d').dataset.ptExpanded, undefined);
  assert.match(markers[0].textContent, /已展开 2 条/);
  assert.equal(refreshRuns(doc, [mk('a', 'skip'), mk('b', 'follow'), mk('c', 'skip')]), 0, 'isolated skips are not grouped');
  assert.equal(doc.querySelectorAll(`.${RUN_CLASS}`).length, 0, 'stale markers removed');
  assert.equal(toggleExpanded(mk('c', 'skip')), true);
  assert.equal(doc.getElementById('c').dataset.ptExpanded, '1');
});

test('reorder: 关注 first within each segment on the real arXiv listing (dt+dd move together), restorable', () => {
  const doc = new JSDOM(readFileSync(new URL('./fixtures/arxiv-list.html', import.meta.url), 'utf8'), { url: 'https://arxiv.org/list/cond-mat.mtrl-sci/new' }).window.document;
  const found = arxivAdapter.findEntries(doc);
  const entries = found.map((e, i) => ({ containers: e.containers, originalIndex: i, label: i % 7 === 0 ? 'follow' : i % 3 === 0 ? 'normal' : 'skip' }));
  const dl = entries[0].containers[0].parentNode;
  const headersBefore = [...dl.children].filter((c) => c.tagName === 'H3').map((h) => h.textContent);
  const idsIn = (el) => [...el.querySelectorAll('dt')].map((dt) => dt.querySelector('a[href*="/abs/"]').getAttribute('href'));
  const originalIds = idsIn(dl);
  const moved = reorder(entries, 'follow-first');
  assert.ok(moved > 0);
  // every dt is still immediately followed by its own dd
  for (const e of entries) assert.equal(e.containers[0].nextElementSibling, e.containers[1]);
  // section headers keep their relative position (segments are sorted independently)
  assert.deepEqual([...dl.children].filter((c) => c.tagName === 'H3').map((h) => h.textContent), headersBefore);
  // within the first segment (before the first header after item 0), follows come first
  const domOrder = [...dl.querySelectorAll('dt')].map((dt) => entries.find((e) => e.containers[0] === dt));
  const firstSkip = domOrder.findIndex((e) => e.label === 'skip');
  const lastFollow = domOrder.slice(0, firstSkip).filter((e) => e.label === 'follow').length;
  assert.ok(lastFollow >= 1);
  assert.equal(domOrder.slice(0, firstSkip).every((e) => e.label !== 'skip'), true);
  reorder(entries, 'original');
  assert.deepEqual(idsIn(dl), originalIds, 'original order restored');
});

test('error state is marked on the container (so 只看关注 never hides a failure) and counted apart from pending', () => {
  const doc = new JSDOM('<div id="c"><h3 id="m"></h3></div><div id="d"><h3 id="n"></h3></div>').window.document;
  const entry = { containers: [doc.getElementById('c')], mount: doc.getElementById('m') };
  renderBadge(entry, { state: 'loading' });
  assert.equal(doc.getElementById('c').dataset.ptError, undefined);
  renderBadge(entry, { state: 'error', message: 'boom' });
  assert.equal(doc.getElementById('c').dataset.ptError, '1');
  doc.getElementById('c').dataset.ptKey = 'k1';
  const other = { containers: [doc.getElementById('d')], mount: doc.getElementById('n') };
  renderBadge(other, { state: 'loading' });
  doc.getElementById('d').dataset.ptKey = 'k2';
  assert.deepEqual(countLabels(doc), { follow: 0, normal: 0, skip: 0, pending: 1, error: 1, total: 2 });
  renderBadge(entry, { state: 'verdict', verdict: { label: 'follow', probs: { follow: 0.9, normal: 0.05, skip: 0.05 } } });
  assert.equal(doc.getElementById('c').dataset.ptError, undefined, 'cleared once a verdict arrives');
});
