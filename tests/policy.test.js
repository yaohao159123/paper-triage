import test from 'node:test';
import assert from 'node:assert/strict';
import { decideLabel, probsFromScoreAnswer, verdictFromAnswers, nextManualLabel, effectiveLabel, matchedReasons } from '../src/shared/policy.js';

test('decideLabel: follow wins when P(follow) >= followMin', () => {
  assert.equal(decideLabel({ skip: 0.1, normal: 0.3, follow: 0.6 }), 'follow');
  assert.equal(decideLabel({ skip: 0.45, normal: 0.05, follow: 0.5 }), 'follow');
});

test('decideLabel: skip needs P(skip) >= skipMin, otherwise normal', () => {
  assert.equal(decideLabel({ skip: 0.6, normal: 0.3, follow: 0.1 }), 'skip');
  assert.equal(decideLabel({ skip: 0.55, normal: 0.35, follow: 0.1 }), 'normal');
  assert.equal(decideLabel({ skip: 0.2, normal: 0.6, follow: 0.2 }), 'normal');
});

test('decideLabel: custom thresholds', () => {
  assert.equal(decideLabel({ skip: 0.5, normal: 0.2, follow: 0.3 }, { skipMin: 0.5 }), 'skip');
  assert.equal(decideLabel({ skip: 0.1, normal: 0.5, follow: 0.4 }, { followMin: 0.4 }), 'follow');
});

test('probsFromScoreAnswer normalises and maps levels', () => {
  const p = probsFromScoreAnswer({ probabilities: { 0: 0.2, 1: 0.2, 2: 0.6 } });
  assert.deepEqual(p, { skip: 0.2, normal: 0.2, follow: 0.6 });
  assert.throws(() => probsFromScoreAnswer({ probabilities: {} }));
});

test('verdictFromAnswers builds a verdict with review prob and meta', () => {
  const answers = {
    paper_3_priority: { type: 'score', score: 1.7, confidence: 0.55, probabilities: { 0: 0.05, 1: 0.2, 2: 0.75 } },
    paper_3_review: { type: 'noul', noul: 0.12 },
  };
  const v = verdictFromAnswers(answers, 3, undefined, { model: 'jev-1.13.0', ts: 1 });
  assert.equal(v.label, 'follow');
  assert.equal(v.reviewProb, 0.12);
  assert.equal(v.model, 'jev-1.13.0');
  assert.equal(v.ts, 1);
  assert.equal(v.manual, null);
  assert.throws(() => verdictFromAnswers(answers, 4));
});

test('manual override cycle and effective label', () => {
  assert.equal(nextManualLabel('follow'), 'normal');
  assert.equal(nextManualLabel('normal'), 'skip');
  assert.equal(nextManualLabel('skip'), 'follow');
  assert.equal(nextManualLabel(null), 'follow');
  assert.equal(effectiveLabel({ label: 'skip', manual: 'follow' }), 'follow');
  assert.equal(effectiveLabel({ label: 'skip', manual: null }), 'skip');
  assert.equal(effectiveLabel(null), null);
});

test('verdict carries reasons, matchedReasons filters by 0.5, unsure flags a flat distribution', () => {
  const answers = {
    paper_0_priority: { type: 'score', score: 1.1, confidence: 0.2, probabilities: { 0: 0.3, 1: 0.4, 2: 0.3 } },
    paper_0_review: { type: 'noul', noul: 0.1 },
    paper_0_topic: { type: 'noul', noul: 0.9 },
    paper_0_method: { type: 'noul', noul: 0.2 },
    paper_0_material: { type: 'noul', noul: 0.55 },
  };
  const v = verdictFromAnswers(answers, 0, undefined, {}, ['topic', 'method', 'material']);
  assert.equal(v.label, 'normal');
  assert.equal(v.unsure, true);
  assert.deepEqual(v.reasons, { topic: 0.9, method: 0.2, material: 0.55 });
  assert.deepEqual(matchedReasons(v), ['topic', 'material']);
  const sure = verdictFromAnswers({ paper_0_priority: { probabilities: { 0: 0, 1: 0.1, 2: 0.9 } } }, 0);
  assert.equal(sure.unsure, false);
  assert.equal(sure.reasons, null);
  assert.deepEqual(matchedReasons(sure), []);
});
