import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { scholarAdapter } from '../src/content/adapters/scholar.js';
import { arxivAdapter } from '../src/content/adapters/arxiv.js';
import { pubmedAdapter } from '../src/content/adapters/pubmed.js';
import { pickAdapter } from '../src/content/adapters/index.js';

const fixture = (name, url) => new JSDOM(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'), { url }).window.document;

test('pickAdapter routes by hostname', () => {
  assert.equal(pickAdapter(new URL('https://scholar.google.com/scholar?q=x')).id, 'scholar');
  assert.equal(pickAdapter(new URL('https://scholar.google.fi/scholar?q=x')).id, 'scholar');
  assert.equal(pickAdapter(new URL('https://arxiv.org/list/cond-mat/new')).id, 'arxiv');
  assert.equal(pickAdapter(new URL('https://pubmed.ncbi.nlm.nih.gov/?term=x')).id, 'pubmed');
  assert.equal(pickAdapter(new URL('https://example.com/')), null);
});

test('scholar: 10 live-captured results with clean titles, snippets, years and mounts', () => {
  const doc = fixture('scholar.html', 'https://scholar.google.com/scholar?hl=en&q=microwave+dielectric+properties+biomass');
  const entries = scholarAdapter.findEntries(doc);
  assert.equal(entries.length, 10);
  const first = entries[0];
  assert.equal(first.paper.title, 'Dielectric properties and microwave heating of oil palm biomass and biochar');
  assert.match(first.paper.abstract, /dielectric properties of oil palm biomass/);
  assert.equal(first.paper.year, '2013');
  assert.match(first.paper.authors, /Salema/);
  assert.match(first.paper.venue, /Industrial Crops/);
  assert.equal(first.mount.className, 'gs_rt');
  assert.equal(first.containers[0].getAttribute('data-cid'), 'x6BpcW0wpHwJ');
  // [HTML] tag entries must not leak the tag into the title
  for (const e of entries) assert.doesNotMatch(e.paper.title, /\[(HTML|PDF|BOOK|CITATION)\]/);
  const acs = entries.find((e) => e.paper.url.includes('pubs.acs.org'));
  assert.equal(acs.paper.doi, '10.1021/ef100623e');
});

test('arxiv list: 45 new-submission entries with ids, abstracts and dt+dd containers', () => {
  const doc = fixture('arxiv-list.html', 'https://arxiv.org/list/cond-mat.mtrl-sci/new');
  const entries = arxivAdapter.findEntries(doc);
  assert.ok(entries.length >= 45, `got ${entries.length}`);
  const first = entries[0];
  assert.equal(first.paper.arxivId, '2609.22268');
  assert.equal(first.paper.title, 'Efficient spectral Galerkin framework for nonlinear transient heat transfer in finite domains');
  assert.match(first.paper.abstract, /temperature-dependent thermophysical properties/);
  assert.equal(first.paper.year, '2026');
  assert.match(first.paper.venue, /Materials Science/);
  assert.equal(first.containers.length, 2);
  assert.equal(first.containers[0].tagName, 'DT');
  assert.equal(first.containers[1].tagName, 'DD');
  assert.ok(first.mount.classList.contains('list-title'));
  const ids = new Set(entries.map((e) => e.paper.arxivId));
  assert.equal(ids.size, entries.length, 'ids unique');
});

test('arxiv search: li.arxiv-result entries', () => {
  const html = `<ul><li class="arxiv-result"><div class="is-marginless"><p class="list-title is-inline-block"><a href="https://arxiv.org/abs/2501.01234">arXiv:2501.01234</a></p></div>
    <p class="title is-5 mathjax">Microwave heating of iron ore fines</p>
    <p class="authors"><span class="search-hit">Authors:</span> <a href="#">A Person</a></p>
    <p class="abstract mathjax"><span class="abstract-short">Short …</span><span class="abstract-full">Full abstract text here. <a class="is-size-7">△ Less</a></span></p></li></ul>`;
  const doc = new JSDOM(html, { url: 'https://arxiv.org/search/?query=x' }).window.document;
  const [e] = arxivAdapter.findEntries(doc);
  assert.equal(e.paper.arxivId, '2501.01234');
  assert.equal(e.paper.title, 'Microwave heating of iron ore fines');
  assert.equal(e.paper.abstract, 'Full abstract text here.');
  assert.equal(e.paper.authors, 'A Person');
  assert.equal(e.paper.year, '2025');
});

test('pubmed: docsum entries with DOI, year, snippet and mount before the title link', () => {
  const doc = fixture('pubmed.html', 'https://pubmed.ncbi.nlm.nih.gov/?term=microwave+dielectric+biomass');
  const entries = pubmedAdapter.findEntries(doc);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].paper.doi, '10.1016/j.biortech.2025.130651');
  assert.equal(entries[0].paper.year, '2025');
  assert.equal(entries[0].paper.venue, 'Bioresour Technol');
  assert.match(entries[0].paper.abstract, /cavity perturbation/);
  assert.equal(entries[0].paper.url, 'https://pubmed.ncbi.nlm.nih.gov/38900001/');
  assert.ok(entries[0].mount.classList.contains('docsum-content'));
  assert.equal(entries[1].paper.doi, '10.1016/j.jhep.2024.03.011');
});
