// DOM rendering of badges, review chips and the greyed-out state. No chrome.* calls here.
import { LABELS, effectiveLabel } from '../shared/policy.js';

export const BADGE_CLASS = 'pt-badge';
export const REVIEW_CLASS = 'pt-review';
export const REVIEW_MIN = 0.5;
const STATE_CLASSES = ['pt-loading', 'pt-error', 'pt-follow', 'pt-normal', 'pt-skip', 'pt-manual'];

export function ensureBadge(entry) {
  let badge = entry.mount.querySelector(`:scope > .${BADGE_CLASS}`);
  if (badge) return badge;
  badge = entry.mount.ownerDocument.createElement('span');
  badge.className = BADGE_CLASS;
  badge.setAttribute('role', 'button');
  badge.tabIndex = 0;
  const after = entry.badgeAfter && entry.badgeAfter.parentNode === entry.mount ? entry.badgeAfter : null;
  if (after) after.after(badge);
  else entry.mount.prepend(badge);
  return badge;
}

/** view: {state:'loading'} | {state:'error', message} | {state:'verdict', verdict} */
export function renderBadge(entry, view) {
  const badge = ensureBadge(entry);
  badge.classList.remove(...STATE_CLASSES);
  badge.dataset.ptState = view.state;
  let label = null;
  let review = false;
  if (view.state === 'loading') {
    badge.classList.add('pt-loading');
    badge.textContent = '判读中…';
    badge.title = 'Jev 判读中…';
  } else if (view.state === 'error') {
    badge.classList.add('pt-error');
    badge.textContent = '未判读';
    badge.title = `未判读：${view.message || '未知错误'}\n点击重试`;
  } else {
    const v = view.verdict;
    label = effectiveLabel(v) || 'normal';
    badge.classList.add(`pt-${label}`);
    if (v.manual) badge.classList.add('pt-manual');
    badge.textContent = LABELS[label].zh;
    badge.title = tooltip(v);
    badge.dataset.ptLabel = label;
    review = typeof v.reviewProb === 'number' && v.reviewProb >= REVIEW_MIN;
  }
  if (!label) delete badge.dataset.ptLabel;
  renderReviewChip(badge, review, view.verdict);
  for (const c of entry.containers) {
    if (label) c.dataset.ptLabel = label;
    else delete c.dataset.ptLabel;
  }
  setSkipped(entry, label === 'skip' && !entry.noGray);
  return badge;
}

function renderReviewChip(badge, show, verdict) {
  const existing = badge.nextElementSibling?.classList?.contains(REVIEW_CLASS) ? badge.nextElementSibling : null;
  if (!show) {
    existing?.remove();
    return;
  }
  const chip = existing || badge.ownerDocument.createElement('span');
  chip.className = REVIEW_CLASS;
  chip.textContent = verdict?.chip || '综述';
  chip.title = verdict?.chipTitle || 'Jev 认为这是综述 / 评述类文章';
  if (!existing) badge.after(chip);
}

export function tooltip(v) {
  const lines = [];
  if (v.probs) {
    const p = v.probs;
    lines.push(`AI 判读：关注 ${pct(p.follow)} · 普通 ${pct(p.normal)} · 跳过 ${pct(p.skip)}`);
    if (typeof v.reviewProb === 'number' && v.reviewProb >= REVIEW_MIN) lines.push(`${v.chipTitle || '可能是综述 / 评述类文章'}（${pct(v.reviewProb)}）`);
    if (v.basis) lines.push(`依据：${{ full: '完整摘要', snippet: '标题 + 摘要片段', title: '仅标题' }[v.basis] || v.basis}`);
  }
  if (v.manual) lines.push(`当前为手动改判（AI 原判：${v.label ? LABELS[v.label].zh : '无'}）`);
  lines.push('点击改判：关注 → 普通 → 跳过 循环；⌥/Alt + 点击恢复 AI 判定');
  return lines.join('\n');
}

export function setSkipped(entry, skipped) {
  for (const c of entry.containers) c.classList.toggle('pt-skipped', skipped);
}

export function setDisabled(doc, disabled) {
  doc.documentElement.classList.toggle('pt-disabled', !!disabled);
}

/** Counts unique papers (arXiv lists carry the key on dt and dd) by effective label. */
export function countLabels(doc) {
  const counts = { follow: 0, normal: 0, skip: 0, pending: 0, total: 0 };
  const seen = new Set();
  for (const el of doc.querySelectorAll('[data-pt-key]')) {
    const key = el.dataset.ptKey;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    counts.total += 1;
    const label = el.dataset.ptLabel;
    if (label in counts) counts[label] += 1;
    else counts.pending += 1;
  }
  return counts;
}

const pct = (x) => `${Math.round((x || 0) * 100)}%`;
