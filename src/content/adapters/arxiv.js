// arXiv listing pages (/list/**: dl > dt + dd) and search pages (/search/**: li.arxiv-result)
import { textWithout } from './scholar.js';

const ABS_ID = /\/abs\/(\d{4}\.\d{4,5})/;

export const arxivAdapter = {
  id: 'arxiv',
  domain: 'paper',
  matches: (loc) => /(^|\.)arxiv\.org$/.test(loc.hostname),
  findEntries(root) {
    const single = absEntry(root);
    return single ? [single] : [...listEntries(root), ...searchEntries(root)];
  },
};

/** Single abstract page (/abs/ID): judge from the full abstract, badge on the title, never greyed. */
function absEntry(root) {
  const titleEl = root.querySelector('#abs h1.title, h1.title.mathjax');
  const abs = root.querySelector('#abs blockquote.abstract, blockquote.abstract');
  if (!titleEl || !abs) return null;
  const meta = (name) => root.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '';
  const arxivId = (meta('citation_arxiv_id').match(/\d{4}\.\d{4,5}/) || [''])[0] || ((root.defaultView?.location?.pathname || '').match(ABS_ID) || [, ''])[1];
  const subject = root.querySelector('.subjects .primary-subject, td.subjects .primary-subject')?.textContent?.trim() || '';
  return {
    id: arxivId || 'abs',
    single: true,
    noGray: true,
    containers: [titleEl],
    mount: titleEl,
    paper: {
      source: 'arxiv',
      title: textWithout(titleEl, '.descriptor, .pt-badge, .pt-review'),
      abstract: textWithout(abs, '.descriptor'),
      abstractFull: true,
      authors: textWithout(root.querySelector('#abs .authors, .authors') || abs, '.descriptor'),
      venue: subject ? `arXiv (${subject})` : 'arXiv',
      year: (meta('citation_date').match(/(19|20)\d{2}/) || [''])[0] || (arxivId ? `20${arxivId.slice(0, 2)}` : ''),
      url: arxivId ? `https://arxiv.org/abs/${arxivId}` : '',
      arxivId,
    },
  };
}

function listEntries(root) {
  const out = [];
  for (const dt of root.querySelectorAll('dl dt')) {
    const dd = dt.nextElementSibling;
    if (!dd || dd.tagName !== 'DD') continue;
    const titleEl = dd.querySelector('.list-title');
    if (!titleEl) continue;
    const title = textWithout(titleEl, '.descriptor, .pt-badge');
    const href = dt.querySelector('a[href*="/abs/"]')?.getAttribute('href') || '';
    const arxivId = (href.match(ABS_ID) || [, ''])[1];
    const subject = dd.querySelector('.list-subjects .primary-subject')?.textContent?.trim() || '';
    out.push({
      id: arxivId || title,
      containers: [dt, dd],
      mount: titleEl,
      paper: {
        source: 'arxiv',
        title,
        abstract: dd.querySelector('p.mathjax')?.textContent || '',
        authors: textWithout(dd.querySelector('.list-authors') || dd, '.descriptor') || '',
        venue: subject ? `arXiv (${subject})` : 'arXiv',
        year: arxivId ? `20${arxivId.slice(0, 2)}` : '',
        url: arxivId ? `https://arxiv.org/abs/${arxivId}` : '',
        arxivId,
      },
    });
  }
  return out;
}

function searchEntries(root) {
  const out = [];
  for (const li of root.querySelectorAll('li.arxiv-result')) {
    const titleEl = li.querySelector('p.title');
    if (!titleEl) continue;
    const title = textWithout(titleEl, '.pt-badge');
    const href = li.querySelector('p.list-title a[href*="/abs/"]')?.getAttribute('href') || '';
    const arxivId = (href.match(ABS_ID) || [, ''])[1];
    const full = li.querySelector('span.abstract-full');
    const abstract = (full ? textWithout(full, 'a') : li.querySelector('span.abstract-short')?.textContent) || '';
    out.push({
      id: arxivId || title,
      containers: [li],
      mount: titleEl,
      paper: {
        source: 'arxiv',
        title,
        abstract,
        authors: textWithout(li.querySelector('p.authors') || li, 'a.is-size-7, .pt-badge').replace(/^Authors:\s*/i, ''),
        venue: 'arXiv',
        year: arxivId ? `20${arxivId.slice(0, 2)}` : '',
        url: arxivId ? `https://arxiv.org/abs/${arxivId}` : '',
        arxivId,
      },
    });
  }
  return out;
}
