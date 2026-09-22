// Google Scholar search results: div.gs_r.gs_or.gs_scl
const YEAR = /\b(19|20)\d{2}\b/;
const DOI_IN_URL = /10\.\d{4,9}\/[^\s?#"']+/i;

export const scholarAdapter = {
  id: 'scholar',
  domain: 'paper',
  matches: (loc) => /^scholar\.google\./.test(loc.hostname),
  findEntries(root) {
    const out = [];
    for (const el of root.querySelectorAll('div.gs_r.gs_or.gs_scl')) {
      const titleEl = el.querySelector('.gs_rt');
      if (!titleEl) continue;
      const title = textWithout(titleEl, '.gs_ctc, .gs_ct1, .gs_ct2, .gs_ctg2, .pt-badge');
      if (!title) continue;
      const link = titleEl.querySelector('a[href]');
      const meta = el.querySelector('.gs_a')?.textContent || '';
      const parts = meta.split(/\s[-–]\s/).map((s) => s.trim()); // Scholar uses NBSP around the dash
      const url = link?.getAttribute('href') || '';
      out.push({
        id: el.getAttribute('data-cid') || url || title,
        containers: [el],
        mount: titleEl,
        paper: {
          source: 'scholar',
          title,
          abstract: el.querySelector('.gs_rs')?.textContent || '',
          authors: parts[0] || '',
          venue: (parts[1] || '').replace(YEAR, '').replace(/[,\s…]+$/, '').trim(),
          year: (meta.match(YEAR) || [''])[0],
          url,
          doi: (url.match(DOI_IN_URL) || [''])[0],
        },
      });
    }
    return out;
  },
};

export function textWithout(el, excludeSelector) {
  const clone = el.cloneNode(true);
  for (const n of clone.querySelectorAll(excludeSelector)) n.remove();
  return clone.textContent.replace(/\s+/g, ' ').trim();
}
