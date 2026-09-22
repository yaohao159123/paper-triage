// PubMed search results: article.full-docsum
import { textWithout } from './scholar.js';

const YEAR = /\b(19|20)\d{2}\b/;
const DOI = /doi:\s*(10\.\d{4,9}\/[^\s.]+(?:\.[^\s.]+)*?)\.?(?:\s|$)/i;

export const pubmedAdapter = {
  id: 'pubmed',
  matches: (loc) => loc.hostname === 'pubmed.ncbi.nlm.nih.gov',
  findEntries(root) {
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
