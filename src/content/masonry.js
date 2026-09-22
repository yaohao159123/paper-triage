// Re-layout for JS-positioned card grids (小红书 feed): cards are position:absolute with transform/left/top
// computed by the site, so hiding a card leaves a hole. We re-place the visible cards column by column,
// remember the site's originals so a mode switch can restore them, and can tell our own writes from the
// site's (so an attribute observer can re-run us when the site re-lays out).
const original = new WeakMap(); // card -> {transform, left, top}
const lastWritten = new WeakMap(); // card -> transform or "left|top" string we wrote

const TRANSLATE = /translate(?:3d)?\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/;
const MATRIX = /matrix\(\s*[-\d.]+,\s*[-\d.]+,\s*[-\d.]+,\s*[-\d.]+,\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\)/;

/** Where the card is now: inline transform / left-top first, computed style as fallback. */
export function readPosition(card) {
  const inlineT = card.style.transform || '';
  let m = inlineT.match(TRANSLATE);
  if (m) return { mode: 'transform', x: Number(m[1]), y: Number(m[2]) };
  if (card.style.left || card.style.top) return { mode: 'lt', x: parseFloat(card.style.left) || 0, y: parseFloat(card.style.top) || 0 };
  const cs = card.ownerDocument.defaultView?.getComputedStyle(card);
  if (!cs) return null;
  const t = cs.transform || '';
  m = t.match(MATRIX) || t.match(TRANSLATE);
  if (m) return { mode: 'transform', x: Number(m[1]), y: Number(m[2]) };
  if (cs.position === 'absolute' && cs.left && cs.left !== 'auto') return { mode: 'lt', x: parseFloat(cs.left) || 0, y: parseFloat(cs.top) || 0 };
  return null;
}

function remember(card) {
  if (!original.has(card)) original.set(card, { transform: card.style.transform, left: card.style.left, top: card.style.top });
}

function place(card, mode, x, y) {
  if (mode === 'transform') {
    card.style.transform = `translate(${x}px, ${y}px)`;
    lastWritten.set(card, card.style.transform);
  } else {
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
    lastWritten.set(card, `${card.style.left}|${card.style.top}`);
  }
}

/** True when the card's current inline position is not the one we wrote last (the site moved it). */
export function movedBySite(card) {
  const ours = lastWritten.get(card);
  if (!ours) return false;
  const now = card.style.transform ? card.style.transform : `${card.style.left}|${card.style.top}`;
  return now !== ours;
}

/** Returns true when it re-laid out the grid; false when the grid is not a JS masonry (nothing touched). */
export function relayoutMasonry(container, cards, { isHidden = (c) => getComputedStyle(c).display === 'none', resetColumns = false } = {}) {
  if (!container || !cards.length) return false;
  const positions = cards.map(readPosition);
  const known = positions.filter(Boolean);
  if (known.length < cards.length * 0.8) return false;
  const mode = known[0].mode;
  const width = cards.find((c) => !isHidden(c))?.getBoundingClientRect().width || 0;
  if (!width) return false;
  if (resetColumns) { delete container.dataset.ptCols; delete container.dataset.ptGap; }
  let cols = Number(container.dataset.ptCols) || 0;
  let gap = Number(container.dataset.ptGap);
  if (!cols) {
    const xs = [...new Set(known.map((p) => Math.round(p.x)))].sort((a, b) => a - b);
    cols = xs.length || 1;
    gap = xs.length > 1 ? Math.max(0, Math.round(xs[1] - xs[0] - width)) : 16;
    container.dataset.ptCols = String(cols);
    container.dataset.ptGap = String(gap);
  }
  const heights = new Array(cols).fill(0);
  for (const card of cards) {
    remember(card);
    if (isHidden(card)) continue;
    const col = heights.indexOf(Math.min(...heights));
    place(card, mode, col * (width + gap), heights[col]);
    heights[col] += (card.offsetHeight || 0) + gap;
  }
  container.style.height = `${Math.max(...heights)}px`;
  container.dataset.ptRelayout = '1';
  return true;
}

/** Put the site's own positions back (used when leaving hide mode). */
export function restoreMasonry(container, cards) {
  if (!container?.dataset.ptRelayout) return false;
  for (const card of cards) {
    const o = original.get(card);
    if (!o) continue;
    card.style.transform = o.transform;
    card.style.left = o.left;
    card.style.top = o.top;
    lastWritten.delete(card);
  }
  container.style.height = '';
  delete container.dataset.ptRelayout;
  delete container.dataset.ptCols;
  delete container.dataset.ptGap;
  return true;
}
