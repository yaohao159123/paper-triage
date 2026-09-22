import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { relayoutMasonry, restoreMasonry } from '../src/content/masonry.js';
import { skipModeFor, DEFAULT_DISPLAY } from '../src/shared/profile.js';
import { applyPromoPolicy } from '../src/shared/policy.js';

function grid(mode) {
  const dom = new JSDOM('<body><div id="feed"></div></body>');
  const doc = dom.window.document;
  const feed = doc.getElementById('feed');
  Object.defineProperty(feed, 'clientWidth', { value: 900 });
  const cards = [];
  const heights = [300, 200, 250, 180, 320, 210];
  heights.forEach((h, i) => {
    const c = doc.createElement('section');
    c.className = 'note-item';
    const col = i % 3;
    const x = col * 216;
    const y = Math.floor(i / 3) * 330;
    if (mode === 'transform') c.style.transform = `translate(${x}px, ${y}px)`;
    else { c.style.left = `${x}px`; c.style.top = `${y}px`; }
    c.style.position = 'absolute';
    Object.defineProperty(c, 'offsetHeight', { value: h });
    c.getBoundingClientRect = () => ({ width: 200, height: h });
    feed.appendChild(c);
    cards.push(c);
  });
  return { doc, feed, cards };
}

for (const mode of ['transform', 'lt']) {
  test(`relayoutMasonry (${mode}): hidden cards are skipped, others packed into the shortest column, restorable`, () => {
    const { feed, cards } = grid(mode);
    const hidden = new Set([cards[1], cards[2]]);
    assert.equal(relayoutMasonry(feed, cards, { isHidden: (c) => hidden.has(c) }), true);
    assert.equal(feed.dataset.ptCols, '3');
    assert.equal(feed.dataset.ptGap, '16');
    const pos = (c) => (mode === 'transform' ? c.style.transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/).slice(1).map(Number) : [parseFloat(c.style.left), parseFloat(c.style.top)]);
    assert.deepEqual(pos(cards[0]), [0, 0]);
    assert.deepEqual(pos(cards[3]), [216, 0], 'first visible after the hidden ones goes to column 2');
    assert.deepEqual(pos(cards[4]), [432, 0]);
    assert.deepEqual(pos(cards[5]), [216, 196], 'shortest column (180+16) gets the next card');
    assert.equal(feed.style.height, `${180 + 16 + 210 + 16}px`, "tallest column: col1 = 180+16+210+16");
    assert.equal(restoreMasonry(feed, cards), true);
    assert.deepEqual(pos(cards[3]), [0, 330], 'original position restored');
    assert.equal(feed.style.height, '');
    assert.equal(restoreMasonry(feed, cards), false, 'nothing to restore twice');
  });
}

test('relayoutMasonry leaves non-JS grids alone', () => {
  const dom = new JSDOM('<body><div id="f"><section></section><section></section></div></body>');
  const feed = dom.window.document.getElementById('f');
  assert.equal(relayoutMasonry(feed, [...feed.children]), false);
  assert.equal(feed.dataset.ptRelayout, undefined);
});

test('skipModeFor: per-site choice beats adapter default beats global', () => {
  assert.equal(skipModeFor(DEFAULT_DISPLAY, 'xhs', 'hide'), 'hide');
  assert.equal(skipModeFor({ ...DEFAULT_DISPLAY, skipModes: { xhs: 'collapse' } }, 'xhs', 'hide'), 'collapse');
  assert.equal(skipModeFor({ ...DEFAULT_DISPLAY, skipMode: 'dim' }, 'scholar'), 'dim');
  assert.equal(skipModeFor(null, 'x'), 'collapse');
});

test('applyPromoPolicy: confident promo becomes skip on feeds only, unless confidently 关注', () => {
  const mk = (label, promo, follow) => ({ label, reviewProb: promo, probs: { skip: 0.1, normal: 1 - 0.1 - follow, follow } });
  assert.equal(applyPromoPolicy(mk('normal', 0.95, 0.1), { promoIsNoise: true }).label, 'skip');
  assert.equal(applyPromoPolicy(mk('normal', 0.95, 0.1), { promoIsNoise: true }).promoSkipped, true);
  assert.equal(applyPromoPolicy(mk('follow', 0.95, 0.85), { promoIsNoise: true }).label, 'follow');
  assert.equal(applyPromoPolicy(mk('normal', 0.5, 0.1), { promoIsNoise: true }).label, 'normal');
  assert.equal(applyPromoPolicy(mk('normal', 0.95, 0.1), { promoIsNoise: false }).label, 'normal', 'papers keep the review noul as information only');
});

test('readPosition falls back to computed transform/left when nothing is inline; movedBySite detects site rewrites', async () => {
  const { readPosition, movedBySite, relayoutMasonry } = await import('../src/content/masonry.js');
  const dom = new JSDOM('<style>#f section { position: absolute; } #f section.a { left: 227px; top: 40px; }</style><body><div id="f"><section class="a"></section><section style="transform: matrix(1, 0, 0, 1, 454, 80);"></section><section style="left: 0px; top: 0px"></section></div></body>');
  const doc = dom.window.document;
  const [a, b, c] = doc.querySelectorAll('section');
  assert.deepEqual(readPosition(b), { mode: 'transform', x: 454, y: 80 }, 'matrix() parsed');
  assert.deepEqual(readPosition(c), { mode: 'lt', x: 0, y: 0 });
  const pa = readPosition(a);
  assert.ok(pa === null || (pa.mode === 'lt' && pa.x === 227), 'stylesheet left/top read through computed style when jsdom resolves it');
  const feed = doc.getElementById('f');
  for (const s of [a, b, c]) { Object.defineProperty(s, 'offsetHeight', { value: 100 }); s.getBoundingClientRect = () => ({ width: 200, height: 100 }); }
  assert.equal(movedBySite(c), false, 'never written by us yet');
  relayoutMasonry(feed, [c, b, a].filter((s) => readPosition(s)), { isHidden: () => false });
  assert.equal(movedBySite(c), false);
  c.style.left = '999px';
  assert.equal(movedBySite(c), true, 'site rewrote the position after us');
});
