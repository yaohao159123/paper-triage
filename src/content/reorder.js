// "关注置顶": move follow entries ahead of normal ahead of skip, within each contiguous sibling segment,
// so section headers (e.g. arXiv "Cross-lists") keep their groups. Original order is restorable.
const RANK = { follow: 0, normal: 1, skip: 2 };

/** entries: [{containers, label, originalIndex}] in current DOM order. mode: 'follow-first' | 'original'. */
export function reorder(entries, mode) {
  const byFirst = new Map(entries.map((e) => [e.containers[0], e]));
  const owned = new Set(entries.flatMap((e) => e.containers));
  const parents = [...new Set(entries.map((e) => e.containers[0].parentNode).filter(Boolean))];
  let moved = 0;
  for (const parent of parents) {
    let segment = [];
    let terminator = null;
    const flush = () => {
      if (segment.length > 1) moved += placeSegment(parent, segment, terminator, mode);
      segment = [];
    };
    for (const child of [...parent.childNodes]) {
      if (child.nodeType !== 1) continue;
      if (child.classList?.contains('pt-run')) continue; // markers are rebuilt afterwards
      const e = byFirst.get(child);
      if (e) segment.push(e);
      else if (owned.has(child)) continue; // trailing dd of a dt+dd pair
      else { terminator = child; flush(); terminator = null; }
    }
    flush();
  }
  return moved;
}

function placeSegment(parent, segment, terminator, mode) {
  const sorted = [...segment].sort((a, b) => {
    if (mode === 'follow-first') {
      const d = (RANK[a.label] ?? 1) - (RANK[b.label] ?? 1);
      if (d) return d;
    }
    return a.originalIndex - b.originalIndex;
  });
  let changed = 0;
  sorted.forEach((e, i) => { if (segment[i] !== e) changed += 1; });
  if (!changed) return 0;
  const anchor = terminator || nextSiblingAfter(segment.at(-1).containers.at(-1));
  for (const e of sorted) for (const c of e.containers) parent.insertBefore(c, anchor);
  return changed;
}

function nextSiblingAfter(el) {
  let n = el.nextSibling;
  return n;
}
