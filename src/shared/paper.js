// Paper record normalisation and cache keys.

export const MAX_ABSTRACT_CHARS = 1200;
export const MAX_TITLE_CHARS = 300;

const WS = /\s+/g;

export function cleanText(value, max = Infinity) {
  if (value == null) return '';
  const s = String(value).replace(WS, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function normalizePaper(raw) {
  const p = {
    title: cleanText(raw.title, MAX_TITLE_CHARS),
    abstract: cleanText(raw.abstract, MAX_ABSTRACT_CHARS),
    venue: cleanText(raw.venue, 200),
    year: cleanText(raw.year, 8),
    authors: cleanText(raw.authors, 300),
    url: cleanText(raw.url, 500),
    doi: normalizeDoi(raw.doi),
    arxivId: normalizeArxivId(raw.arxivId),
    source: cleanText(raw.source, 40),
    abstractFull: !!raw.abstractFull,
    tweetId: cleanText(raw.tweetId, 40),
    postId: cleanText(raw.postId, 64),
    quotedText: cleanText(raw.quotedText, 600),
  };
  p.key = paperKey(p);
  return p;
}

export function normalizeDoi(doi) {
  if (!doi) return '';
  const m = String(doi).match(/10\.\d{4,9}\/[^\s"'<>]+/i);
  return m ? m[0].toLowerCase().replace(/[.,;)]+$/, '') : '';
}

export function normalizeArxivId(id) {
  if (!id) return '';
  const m = String(id).match(/(\d{4}\.\d{4,5})(v\d+)?/);
  return m ? m[1] : '';
}

export function titleSlug(title) {
  return cleanText(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/ /g, '-')
    .slice(0, 160);
}

/** Stable key: DOI, else arXiv id, else slugged title. */
export function paperKey(p) {
  if (p.tweetId) return `tweet:${p.tweetId}`;
  if (p.postId) return `xhs:${p.postId}`;
  if (p.doi) return `doi:${p.doi}`;
  if (p.arxivId) return `arxiv:${p.arxivId}`;
  return `title:${titleSlug(p.title)}`;
}

/** What the judgment was based on; a 'full' abstract later replaces a 'snippet'/'title' verdict. */
export function basisOf(paper) {
  if (paper.abstractFull && paper.abstract) return 'full';
  return paper.abstract ? 'snippet' : 'title';
}

export const BASIS_RANK = { title: 0, snippet: 1, full: 2 };

export function chunk(items, size) {
  if (!(size > 0)) throw new Error('chunk size must be > 0');
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
