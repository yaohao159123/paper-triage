// DOM rendering of badges, chips, reasons and per-entry state classes. No chrome.* calls here.
import { LABELS, effectiveLabel, matchedReasons } from '../shared/policy.js';

export const BADGE_CLASS = 'pt-badge';
export const REVIEW_CLASS = 'pt-review';
export const REASONS_CLASS = 'pt-reasons';
export const REVIEW_MIN = 0.5;
const STATE_CLASSES = ['pt-loading', 'pt-error', 'pt-follow', 'pt-normal', 'pt-skip', 'pt-manual', 'pt-unsure'];

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

/** view: {state:'loading'} | {state:'error', message} | {state:'verdict', verdict, reasonLabels?} */
export function renderBadge(entry, view) {
  const badge = ensureBadge(entry);
  badge.classList.remove(...STATE_CLASSES);
  badge.dataset.ptState = view.state;
  let label = null;
  let review = false;
  let reasonsText = '';
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
    if (v.unsure && !v.manual) badge.classList.add('pt-unsure');
    badge.textContent = LABELS[label].zh;
    badge.title = tooltip(v, view.reasonLabels);
    badge.dataset.ptLabel = label;
    review = typeof v.reviewProb === 'number' && v.reviewProb >= REVIEW_MIN;
    if (label !== 'skip' && view.reasonLabels) {
      reasonsText = matchedReasons(v).map((k) => view.reasonLabels[k] || k).join(' · ');
    }
  }
  if (!label) delete badge.dataset.ptLabel;
  renderChip(badge, review, view.verdict);
  renderReasons(badge, reasonsText);
  // State lives in data-* attributes: React-managed hosts (X, 小红书) rewrite className on re-render and would wipe classes.
  for (const c of entry.containers) {
    if (entry.single) c.dataset.ptSingle = '1';
    if (label) c.dataset.ptLabel = label;
    else delete c.dataset.ptLabel;
    if (label === 'skip' && !entry.noGray) c.dataset.ptSkipped = '1';
    else delete c.dataset.ptSkipped;
    if (label === 'follow' && !entry.noGray) c.dataset.ptAccent = '1';
    else delete c.dataset.ptAccent;
  }
  return badge;
}

function chipAfter(badge) {
  return badge.nextElementSibling?.classList?.contains(REVIEW_CLASS) ? badge.nextElementSibling : null;
}

function renderChip(badge, show, verdict) {
  const existing = chipAfter(badge);
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

/** "命中：课题 · 材料" after the badge/chip; removed when empty. */
function renderReasons(badge, text) {
  const anchor = chipAfter(badge) || badge;
  const existing = anchor.nextElementSibling?.classList?.contains(REASONS_CLASS) ? anchor.nextElementSibling : null;
  if (!text) {
    existing?.remove();
    return;
  }
  const el = existing || badge.ownerDocument.createElement('span');
  el.className = REASONS_CLASS;
  el.textContent = `命中 ${text}`;
  el.title = '与画像的哪些维度相符（Jev 分维度判定，≥50%）';
  if (!existing) anchor.after(el);
}

export function tooltip(v, reasonLabels) {
  const lines = [];
  if (v.probs) {
    const p = v.probs;
    lines.push(`AI 判读：关注 ${pct(p.follow)} · 普通 ${pct(p.normal)} · 跳过 ${pct(p.skip)}${v.unsure ? '（把握不大）' : ''}`);
    if (v.reasons && reasonLabels) {
      lines.push(`维度：${Object.entries(v.reasons).map(([k, x]) => `${reasonLabels[k] || k} ${pct(x)}`).join(' · ')}`);
    }
    if (typeof v.reviewProb === 'number' && v.reviewProb >= REVIEW_MIN) lines.push(`${v.chipTitle || '可能是综述 / 评述类文章'}（${pct(v.reviewProb)}）${v.promoSkipped ? '，已按推广 / 广告规则判为跳过' : ''}`);
    if (v.basis) lines.push(`依据：${{ full: '完整摘要', snippet: '标题 + 摘要片段', title: '仅标题' }[v.basis] || v.basis}`);
  }
  if (v.manual) lines.push(`当前为手动改判（AI 原判：${v.label ? LABELS[v.label].zh : '无'}）`);
  lines.push('点击改判：关注 → 普通 → 跳过 循环；⌥/Alt + 点击恢复 AI 判定；双击折叠项可展开');
  return lines.join('\n');
}

export function setSkipped(entry, skipped) {
  for (const c of entry.containers) {
    if (skipped) c.dataset.ptSkipped = '1';
    else delete c.dataset.ptSkipped;
  }
}

/** Root flags are data-* too (html[data-pt-...]), same reason. */
export function setRootFlag(doc, name, on) {
  if (on) doc.documentElement.dataset[name] = '1';
  else delete doc.documentElement.dataset[name];
}

export function setDisabled(doc, disabled) {
  setRootFlag(doc, 'ptDisabled', !!disabled);
}

/** html[data-pt-skip="<mode>"] drives how skipped entries look: collapse | dim | hide. */
export function setSkipMode(doc, mode) {
  doc.documentElement.dataset.ptSkip = ['collapse', 'dim', 'hide'].includes(mode) ? mode : 'collapse';
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
