// Floating summary bar: counts, 跳过项显示方式, 只看关注, 关注置顶, next 关注, re-judge. Pure DOM.
export const TOOLBAR_CLASS = 'pt-toolbar';
export const SKIP_MODE_LABELS = { collapse: '跳过：折叠', dim: '跳过：变灰', hide: '跳过：隐藏' };
const STORAGE_KEY = 'pt-follow-only';

export function setFollowOnly(doc, on) {
  if (on) doc.documentElement.dataset.ptFollowOnly = '1';
  else delete doc.documentElement.dataset.ptFollowOnly;
  try { doc.defaultView?.sessionStorage?.setItem(STORAGE_KEY, on ? '1' : '0'); } catch { /* private mode etc. */ }
}

export function savedFollowOnly(doc) {
  try { return doc.defaultView?.sessionStorage?.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

/** Scrolls to the next 关注 entry below the viewport top (wraps around); returns the element or null. */
export function jumpToNextFollow(doc) {
  const seen = new Set();
  const targets = [];
  for (const el of doc.querySelectorAll('[data-pt-key][data-pt-label="follow"]')) {
    if (seen.has(el.dataset.ptKey)) continue;
    seen.add(el.dataset.ptKey);
    targets.push(el);
  }
  if (!targets.length) return null;
  const next = targets.find((el) => el.getBoundingClientRect().top > 40) || targets[0];
  next.scrollIntoView({ block: 'start', behavior: 'smooth' });
  next.dataset.ptFlash = '1';
  setTimeout(() => delete next.dataset.ptFlash, 1200);
  return next;
}

/**
 * handlers: { onSkipMode(mode), onFollowOnly(bool), onSort(bool), onRerun() }
 * state: { skipMode, sortFollowFirst, sortable }
 */
export function mountToolbar(doc, handlers = {}, state = {}) {
  const existing = doc.querySelector(`.${TOOLBAR_CLASS}`);
  if (existing) existing.remove();
  const bar = doc.createElement('div');
  bar.className = TOOLBAR_CLASS;
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', '文献分诊');
  bar.innerHTML = `
    <span class="pt-tb-counts" aria-live="polite"></span>
    <select class="pt-tb-skipmode" aria-label="跳过项显示方式" title="跳过的条目怎么显示">
      ${Object.entries(SKIP_MODE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
    </select>
    <button type="button" data-action="followonly" class="pt-tb-toggle" title="只显示「关注」（Alt+F）">只看关注</button>
    ${state.sortable ? '<button type="button" data-action="sort" class="pt-tb-toggle" title="把「关注」排到前面，再点恢复原顺序（Alt+S）">关注置顶</button>' : ''}
    <button type="button" data-action="next" title="跳到下一条「关注」（Alt+N）">↓ 关注</button>
    <button type="button" data-action="rerun" title="本页全部重新判读（跳过缓存）">重判</button>
    <button type="button" data-action="collapse" class="pt-tb-collapse" title="收起">×</button>`;
  const counts = bar.querySelector('.pt-tb-counts');
  const select = bar.querySelector('.pt-tb-skipmode');
  const followBtn = bar.querySelector('[data-action="followonly"]');
  const sortBtn = bar.querySelector('[data-action="sort"]');
  let followOnly = savedFollowOnly(doc);
  let sortOn = !!state.sortFollowFirst;

  function setSkipMode(mode) {
    select.value = mode in SKIP_MODE_LABELS ? mode : 'collapse';
  }
  function setFollow(on) {
    followOnly = !!on;
    setFollowOnly(doc, followOnly);
    followBtn.classList.toggle('pt-tb-active', followOnly);
    handlers.onFollowOnly?.(followOnly);
  }
  function setSort(on) {
    sortOn = !!on;
    sortBtn?.classList.toggle('pt-tb-active', sortOn);
    handlers.onSort?.(sortOn);
  }
  function update(c) {
    counts.innerHTML = `<b class="pt-c-follow">关注 ${c.follow}</b> · <span class="pt-c-normal">普通 ${c.normal}</span> · <span class="pt-c-skip">跳过 ${c.skip}</span>${c.pending ? ` · 判读中 ${c.pending}` : ''}`;
    bar.dataset.ptFollow = String(c.follow);
  }
  select.addEventListener('change', () => handlers.onSkipMode?.(select.value));
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'followonly') setFollow(!followOnly);
    else if (a === 'sort') setSort(!sortOn);
    else if (a === 'next') jumpToNextFollow(doc);
    else if (a === 'rerun') handlers.onRerun?.();
    else if (a === 'collapse') {
      const collapsed = bar.classList.toggle('pt-tb-collapsed');
      b.textContent = collapsed ? '分诊' : '×';
      b.title = collapsed ? '展开文献分诊工具条' : '收起';
    }
  });
  doc.body.appendChild(bar);
  setSkipMode(state.skipMode || 'collapse');
  setFollowOnly(doc, followOnly);
  followBtn.classList.toggle('pt-tb-active', followOnly);
  sortBtn?.classList.toggle('pt-tb-active', sortOn);
  update({ follow: 0, normal: 0, skip: 0, pending: 0 });
  return {
    element: bar,
    update,
    setSkipMode,
    setFollowOnly: setFollow,
    setSort,
    getFollowOnly: () => followOnly,
    getSort: () => sortOn,
  };
}
