// Floating summary bar: counts, filters (只看关注 / 隐藏跳过), jump to next 关注, re-judge. Pure DOM.
export const TOOLBAR_CLASS = 'pt-toolbar';
export const FILTERS = ['all', 'follow', 'hideskip'];
const FILTER_CLASS = { follow: 'pt-filter-follow', hideskip: 'pt-filter-hideskip' };
const STORAGE_KEY = 'pt-filter';

export function applyFilter(doc, mode) {
  const root = doc.documentElement;
  for (const cls of Object.values(FILTER_CLASS)) root.classList.remove(cls);
  if (FILTER_CLASS[mode]) root.classList.add(FILTER_CLASS[mode]);
  try { doc.defaultView?.sessionStorage?.setItem(STORAGE_KEY, mode); } catch { /* private mode etc. */ }
}

export function savedFilter(doc) {
  try {
    const m = doc.defaultView?.sessionStorage?.getItem(STORAGE_KEY);
    return FILTERS.includes(m) ? m : 'all';
  } catch { return 'all'; }
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
  next.classList.add('pt-flash');
  setTimeout(() => next.classList.remove('pt-flash'), 1200);
  return next;
}

export function mountToolbar(doc, handlers = {}) {
  const existing = doc.querySelector(`.${TOOLBAR_CLASS}`);
  if (existing) existing.remove();
  const bar = doc.createElement('div');
  bar.className = TOOLBAR_CLASS;
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', '文献分诊');
  bar.innerHTML = `
    <span class="pt-tb-counts" aria-live="polite"></span>
    <span class="pt-tb-group" role="group" aria-label="筛选">
      <button type="button" data-filter="all">全部</button>
      <button type="button" data-filter="follow">只看关注</button>
      <button type="button" data-filter="hideskip">隐藏跳过</button>
    </span>
    <button type="button" data-action="next" title="跳到下一条「关注」（Alt+N）">↓ 关注</button>
    <button type="button" data-action="rerun" title="本页全部重新判读（跳过缓存）">重判</button>
    <button type="button" data-action="collapse" class="pt-tb-collapse" title="收起">×</button>`;
  const counts = bar.querySelector('.pt-tb-counts');
  const buttons = [...bar.querySelectorAll('[data-filter]')];
  let mode = savedFilter(doc);

  function setFilter(next) {
    mode = FILTERS.includes(next) ? next : 'all';
    applyFilter(doc, mode);
    for (const b of buttons) b.classList.toggle('pt-tb-active', b.dataset.filter === mode);
    handlers.onFilter?.(mode);
  }
  function update(c) {
    counts.innerHTML = `<b class="pt-c-follow">关注 ${c.follow}</b> · <span class="pt-c-normal">普通 ${c.normal}</span> · <span class="pt-c-skip">跳过 ${c.skip}</span>${c.pending ? ` · 判读中 ${c.pending}` : ''}`;
    bar.dataset.ptFollow = String(c.follow);
  }
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.filter) setFilter(b.dataset.filter);
    else if (b.dataset.action === 'next') jumpToNextFollow(doc);
    else if (b.dataset.action === 'rerun') handlers.onRerun?.();
    else if (b.dataset.action === 'collapse') {
      const collapsed = bar.classList.toggle('pt-tb-collapsed');
      b.textContent = collapsed ? '分诊' : '×';
      b.title = collapsed ? '展开文献分诊工具条' : '收起';
    }
  });
  doc.body.appendChild(bar);
  setFilter(mode);
  update({ follow: 0, normal: 0, skip: 0, pending: 0 });
  return { element: bar, update, setFilter, getFilter: () => mode };
}
