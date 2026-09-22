import { scholarAdapter } from './scholar.js';
import { arxivAdapter } from './arxiv.js';
import { pubmedAdapter } from './pubmed.js';

export const ADAPTERS = [scholarAdapter, arxivAdapter, pubmedAdapter];

export function pickAdapter(loc) {
  return ADAPTERS.find((a) => a.matches(loc)) || null;
}
