// PubMed search results: article.full-docsum
import { textWithout } from './scholar.js';

const YEAR = /\b(19|20)\d{2}\b/;
const DOI = /doi:\s*(10\.\d{4,9}\/[^\s.]+(?:\.[^\s.]+)*?)\.?(?:\s|$)/i;

export const pubmedAdapter = {
  id: 'pubmed',
  matches: (loc) => loc.hostname === 'pubmed.ncbi.nlm.nih.gov',
  findEntries(root) {
    const single = articleEntry(root);
    if (single) return [single];
    const out = [];
    const articles = root.querySelectorAll('article.full-docsum');
    for (const art of articles.length ? articles : root.querySelectorAll('.docsum-wrap')) {
      const link = art.querySelector('a.docsum-title');
      if (!link) continue;
      const title = textWithout(link, '.pt-badge');
      const mount = art.querySelector('.docsum-content') || link.parentElement;
      const citation = (art.querySelector('.docsum-journal-citation.full-journal-citation') || art.querySelector('.docsum-journal-citation'))?.textContent || '';
      const pmid = link.getAttribute('data-article-id') || art.getAttribute('data-pmid') || '';
      out.push({
        id: pmid || title,
        containers: [art],
        mount,
        paper: {
          source: 'pubmed',
          title,
          abstract: art.querySelector('.full-view-snippet')?.textContent || '',
          authors: (art.querySelector('.docsum-authors.full-authors') || art.querySelector('.docsum-authors'))?.textContent || '',
          venue: citation.split('.')[0].trim(),
          year: (citation.match(YEAR) || [''])[0],
          url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : '',
          doi: (citation.match(DOI) || [, ''])[1],
        },
      });
    }
    return out;
  },
};

/** Single article page (/<pmid>/): full abstract, badge before the title, never greyed. */
function articleEntry(root) {
  const titleEl = root.querySelector('h1.heading-title');
  const abs = root.querySelector('#abstract .abstract-content, #abstract, div.abstract');
  if (!titleEl || !abs) return null;
  const meta = (name) => root.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '';
  const pmid = meta('citation_pmid') || root.querySelector('.current-id')?.textContent?.trim() || '';
  const cit = root.querySelector('.article-citation .cit, span.cit')?.textContent || '';
  const doiText = root.querySelector('.identifier.doi a, span.doi a')?.textContent || cit;
  return {
    id: pmid || 'article',
    single: true,
    noGray: true,
    containers: [titleEl],
    mount: titleEl,
    paper: {
      source: 'pubmed',
      title: textWithout(titleEl, '.pt-badge, .pt-review'),
      abstract: textWithout(abs, 'strong.sub-title, .pt-badge').replace(/^Abstract\s*/i, ''),
      abstractFull: true,
      authors: meta('citation_authors') || [...root.querySelectorAll('.authors-list .full-name')].map((a) => a.textContent.trim()).join(', '),
      venue: meta('citation_journal_title') || cit.split('.')[0].trim(),
      year: (meta('citation_date').match(YEAR) || cit.match(YEAR) || [''])[0],
      url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : '',
      doi: (doiText.match(/10\.\d{4,9}\/[^\s"'<>]+/i) || [''])[0],
    },
  };
}
