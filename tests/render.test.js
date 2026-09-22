import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderBadge, countLabels, REVIEW_CLASS } from '../src/content/render.js';
import { mountToolbar, jumpToNextFollow, applyFilter } from '../src/content/toolbar.js';

function page() {
  const dom = new JSDOM('<!doctype html><body><dl><dt id="dt1"></dt><dd id="dd1"><div class="t"><span class="descriptor">Title:</span> A</div></dd><dt id="dt2"></dt><dd id="dd2"><div class="t">B</div></dd></dl></body>', { url: 'https://arxiv.org/list/x/new' });
  const doc = dom.window.document;
  const e1 = { containers: [doc.getElementById('dt1'), doc.getElementById('dd1')], mount: doc.querySelector('#dd1 .t'), badgeAfter: doc.querySelector('#dd1 .descriptor') };
  const e2 = { containers: [doc.getElementById('dt2'), doc.getElementById('dd2')], mount: doc.querySelector('#dd2 .t') };
  for (const [i, e] of [e1, e2].entries()) for (const c of e.containers) c.dataset.ptKey = `k${i}`;
  return { dom, doc, e1, e2 };
}

test('renderBadge: label attributes on all containers, review chip, grey state, loading clears label', () => {
  const { doc, e1, e2 } = page();
  const badge = renderBadge(e1, { state: 'verdict', verdict: { label: 'skip', probs: { skip: 0.8, normal: 0.1, follow: 0.1 }, reviewProb: 0.9, basis: 'snippet' } });
  assert.equal(badge.textContent, '跳过');
  assert.equal(badge.previousElementSibling.className, 'descriptor', 'badge sits after the Title: descriptor');
  assert.equal(badge.nextElementSibling.className, REVIEW_CLASS);
  assert.equal(e1.containers[0].dataset.ptLabel, 'skip');
  assert.equal(e1.containers[1].dataset.ptLabel, 'skip');
  assert.ok(e1.containers[1].classList.contains('pt-skipped'));
  assert.match(badge.title, /完整摘要|摘要片段/);
  renderBadge(e1, { state: 'verdict', verdict: { label: 'skip', manual: 'follow', probs: { skip: 0.8, normal: 0.1, follow: 0.1 }, reviewProb: 0.1 } });
  assert.equal(badge.textContent, '关注');
  assert.ok(badge.classList.contains('pt-manual'));
  assert.equal(badge.nextElementSibling?.className, undefined, 'review chip removed');
  assert.ok(!e1.containers[1].classList.contains('pt-skipped'));
  renderBadge(e1, { state: 'loading' });
  assert.equal(e1.containers[0].dataset.ptLabel, undefined);
  // noGray entries keep the label but are never greyed
  e2.noGray = true;
  renderBadge(e2, { state: 'verdict', verdict: { label: 'skip', probs: { skip: 1, normal: 0, follow: 0 } } });
  assert.ok(!e2.containers[1].classList.contains('pt-skipped'));
  assert.equal(e2.containers[1].dataset.ptLabel, 'skip');
});

test('countLabels counts unique keys (dt+dd once) and pending', () => {
  const { doc, e1, e2 } = page();
  renderBadge(e1, { state: 'verdict', verdict: { label: 'follow', probs: { skip: 0, normal: 0, follow: 1 } } });
  renderBadge(e2, { state: 'loading' });
  assert.deepEqual(countLabels(doc), { follow: 1, normal: 0, skip: 0, pending: 1, total: 2 });
});

test('toolbar: mounts once, updates counts, filters toggle html classes, next jumps to a follow entry', () => {
  const { dom, doc, e1, e2 } = page();
  const scrolled = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.id); };
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 100 });
  const reruns = [];
  mountToolbar(doc, {});
  const bar = mountToolbar(doc, { onRerun: () => reruns.push(1) }); // remounting replaces, never duplicates
  assert.equal(doc.querySelectorAll('.pt-toolbar').length, 1);
  bar.update({ follow: 2, normal: 3, skip: 4, pending: 0 });
  assert.match(doc.querySelector('.pt-tb-counts').textContent, /关注 2 · 普通 3 · 跳过 4/);
  bar.element.querySelector('[data-filter="follow"]').click();
  assert.ok(doc.documentElement.classList.contains('pt-filter-follow'));
  assert.equal(bar.getFilter(), 'follow');
  bar.element.querySelector('[data-filter="hideskip"]').click();
  assert.ok(!doc.documentElement.classList.contains('pt-filter-follow'));
  assert.ok(doc.documentElement.classList.contains('pt-filter-hideskip'));
  assert.equal(dom.window.sessionStorage.getItem('pt-filter'), 'hideskip');
  bar.element.querySelector('[data-action="rerun"]').click();
  assert.equal(reruns.length, 1);
  renderBadge(e2, { state: 'verdict', verdict: { label: 'follow', probs: { skip: 0, normal: 0, follow: 1 } } });
  renderBadge(e1, { state: 'verdict', verdict: { label: 'skip', probs: { skip: 1, normal: 0, follow: 0 } } });
  const target = jumpToNextFollow(doc);
  assert.equal(target.id, 'dt2');
  assert.deepEqual(scrolled, ['dt2']);
  applyFilter(doc, 'all');
  assert.equal(doc.documentElement.className, '');
});
