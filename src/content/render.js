// DOM rendering of badges and the greyed-out state. No chrome.* calls here.
import { LABELS, effectiveLabel } from '../shared/policy.js';

export const BADGE_CLASS = 'pt-badge';
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
  let skipped = false;
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
    const label = effectiveLabel(v) || 'normal';
    badge.classList.add(`pt-${label}`);
    if (v.manual) badge.classList.add('pt-manual');
    badge.textContent = LABELS[label].zh;
    badge.title = tooltip(v);
    badge.dataset.ptLabel = label;
    skipped = label === 'skip';
  }
  setSkipped(entry, skipped);
  return badge;
}

export function tooltip(v) {
  const lines = [];
  if (v.probs) {
    const p = v.probs;
    lines.push(`AI 判读：关注 ${pct(p.follow)} · 普通 ${pct(p.normal)} · 跳过 ${pct(p.skip)}`);
    if (typeof v.reviewProb === 'number' && v.reviewProb >= 0.5) lines.push(`可能是综述 / 评述类文章（${pct(v.reviewProb)}）`);
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

const pct = (x) => `${Math.round((x || 0) * 100)}%`;
