import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePaper, paperKey, normalizeDoi, normalizeArxivId, chunk, MAX_ABSTRACT_CHARS } from '../src/shared/paper.js';

test('paperKey prefers DOI, then arXiv id, then title slug', () => {
  assert.equal(paperKey({ doi: '10.1016/j.biortech.2025.1', arxivId: '2609.1', title: 'X' }), 'doi:10.1016/j.biortech.2025.1');
  assert.equal(paperKey({ doi: '', arxivId: '2609.22268', title: 'X' }), 'arxiv:2609.22268');
  assert.equal(paperKey({ doi: '', arxivId: '', title: '  Microwave Dielectric: Properties, of Biomass!  ' }), 'title:microwave-dielectric-properties-of-biomass');
});

test('normalizePaper trims, caps and derives key; same title on two sites shares a key', () => {
  const a = normalizePaper({ title: 'A   title\nhere', abstract: 'x'.repeat(5000), source: 'scholar' });
  const b = normalizePaper({ title: 'A title here.', source: 'pubmed' });
  assert.equal(a.title, 'A title here');
  assert.equal(a.abstract.length, MAX_ABSTRACT_CHARS);
  assert.equal(a.key, b.key);
});

test('DOI and arXiv id normalisation', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1021/ACS.IECR.3C00123.'), '10.1021/acs.iecr.3c00123');
  assert.equal(normalizeDoi('no doi'), '');
  assert.equal(normalizeArxivId('arXiv:2609.22268v2'), '2609.22268');
  assert.equal(normalizeArxivId('/abs/2609.22268'), '2609.22268');
});

test('chunk splits evenly', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
  assert.throws(() => chunk([1], 0));
});
