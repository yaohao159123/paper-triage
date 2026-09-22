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

test('questions: one score + review noul + three reason nouls per paper, referencing papers[i] with backticks', () => {
  const q = buildTriageQuestions(3);
  assert.equal(Object.keys(q).length, 15);
  assert.equal(Object.keys(buildTriageQuestions(3, { reasons: false })).length, 6);
  for (const k of ['topic', 'method', 'material']) {
    assert.equal(q[`paper_2_${k}`].type, 'noul');
    assert.match(q[`paper_2_${k}`].instructions, /`papers\[2\]`/);
    assert.ok(q[`paper_2_${k}`].criteria.true && q[`paper_2_${k}`].criteria.false);
  }
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

test('tweet domain: reader profile + tweets state, same answer ids as papers so policy code is shared', async () => {
  const { buildTweetState, buildTweetQuestions, DOMAINS, TWEET_LEVELS } = await import('../src/shared/questions.js');
  const { DEFAULT_TWEET_PROFILE } = await import('../src/shared/profile.js');
  const tweets = [normalizePaper({ title: 'x', abstract: 'Full tweet text', authors: 'A @a', quotedText: 'q', tweetId: '1', source: 'x' })];
  const state = buildTweetState(DEFAULT_TWEET_PROFILE, tweets);
  assert.deepEqual(Object.keys(state), ['reader', 'tweets']);
  assert.deepEqual(state.tweets[0], { text: 'Full tweet text', author: 'A @a', quoted_text: 'q' });
  assert.ok(state.reader.interests.length && state.reader.noise.length);
  const q = buildTweetQuestions(2);
  assert.deepEqual(Object.keys(q), ['paper_0_priority', 'paper_0_review', 'paper_0_interest', 'paper_0_concrete', 'paper_0_source', 'paper_1_priority', 'paper_1_review', 'paper_1_interest', 'paper_1_concrete', 'paper_1_source']);
  assert.match(q.paper_1_source.instructions, /`tweets\[1\]`/);
  assert.equal(q.paper_1_priority.criteria, TWEET_LEVELS);
  assert.match(q.paper_1_priority.instructions.question, /`tweets\[1\]`/);
  assert.equal(DOMAINS.tweet.chip, '推广');
  assert.equal(tweets[0].key, 'tweet:1');
});
