// Runs of consecutive skipped entries get one "已折叠 N 条" marker; clicking it expands the run. Pure DOM.
export const RUN_CLASS = 'pt-run';
export const EXPANDED_CLASS = 'pt-expanded';

/** entries in DOM order: [{key, containers, label}] */
export function refreshRuns(doc, entries, { minRun = 2 } = {}) {
  for (const m of doc.querySelectorAll(`.${RUN_CLASS}`)) m.remove();
  const runs = [];
  let current = [];
  const flush = () => { if (current.length >= minRun) runs.push(current); current = []; };
  for (const e of entries) {
    if (e.label === 'skip') current.push(e);
    else flush();
  }
  flush();
  for (const run of runs) {
    const first = run[0].containers[0];
    const marker = doc.createElement('div');
    marker.className = RUN_CLASS;
    marker.setAttribute('role', 'button');
    marker.tabIndex = 0;
    marker.dataset.ptCount = String(run.length);
    const expanded = run.every((e) => e.containers[0].classList.contains(EXPANDED_CLASS));
    setMarkerText(marker, run.length, expanded);
    marker.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const open = !marker.classList.contains('pt-run-open');
      for (const e of run) for (const c of e.containers) c.classList.toggle(EXPANDED_CLASS, open);
      setMarkerText(marker, run.length, open);
    });
    if (expanded) marker.classList.add('pt-run-open');
    first.parentNode?.insertBefore(marker, first);
  }
  return runs.length;
}

function setMarkerText(marker, n, open) {
  marker.classList.toggle('pt-run-open', open);
  marker.textContent = open ? `▾ 已展开 ${n} 条跳过（点击折叠）` : `▸ 已折叠 ${n} 条跳过（点击展开）`;
}

/** Toggle one entry's expansion (double-click on a collapsed item). */
export function toggleExpanded(entry) {
  const open = !entry.containers[0].classList.contains(EXPANDED_CLASS);
  for (const c of entry.containers) c.classList.toggle(EXPANDED_CLASS, open);
  return open;
}
