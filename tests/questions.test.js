import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTriageState, buildTriageQuestions, PRIORITY_LEVELS } from '../src/shared/questions.js';
import { normalizePaper } from '../src/shared/paper.js';
import { DEFAULT_PROFILE } from '../src/shared/profile.js';

test('state carries researcher profile and per-paper fields only', () => {
  const papers = [normalizePaper({ title: 'T1', abstract: 'A1', venue: 'V', year: '2025', url: 'u', authors: 'x' }), normalizePaper({ title: 'T2' })];
  const state = buildTriageState(DEFAULT_PROFILE, papers);
  assert.deepEqual(Object.keys(state), ['researcher', 'papers']);
  assert.equal(state.researcher.summary, DEFAULT_PROFILE.summary);
  assert.equal(state.researcher.core_topics.length, DEFAULT_PROFILE.core_topics.length);
  assert.deepEqual(state.papers[0], { title: 'T1', abstract_or_snippet: 'A1', venue: 'V', year: '2025' });
  assert.deepEqual(state.papers[1], { title: 'T2', abstract_or_snippet: '' });
});

test('questions: one score + one noul per paper, referencing papers[i] with backticks', () => {
  const q = buildTriageQuestions(3);
  assert.equal(Object.keys(q).length, 6);
  assert.equal(q.paper_2_priority.type, 'score');
  assert.equal(q.paper_2_priority.criteria, PRIORITY_LEVELS);
  assert.equal(PRIORITY_LEVELS.length, 3);
  assert.match(q.paper_2_priority.instructions.question, /`papers\[2\]`/);
  assert.match(q.paper_2_priority.instructions.how_to_judge, /`papers\[2\]\.title`/);
  assert.equal(q.paper_2_review.type, 'noul');
  assert.match(q.paper_2_review.instructions, /`papers\[2\]`/);
  assert.ok(q.paper_2_review.criteria.true && q.paper_2_review.criteria.false);
});

test('serialised state for a 10-paper batch stays well inside the 32k-token state budget', () => {
  const papers = Array.from({ length: 10 }, (_, i) => normalizePaper({ title: `Paper ${i}`, abstract: 'lorem ipsum '.repeat(120) }));
  const bytes = JSON.stringify(buildTriageState(DEFAULT_PROFILE, papers)).length;
  assert.ok(bytes < 40_000, `state is ${bytes} bytes`);
});
