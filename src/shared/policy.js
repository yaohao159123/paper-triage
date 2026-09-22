// Turns Jev answers into the three badges. Thresholds live here, in code, not in the prompt.
import { DEFAULT_THRESHOLDS } from './profile.js';

export const LABELS = {
  follow: { zh: '关注', level: 2 },
  normal: { zh: '普通', level: 1 },
  skip: { zh: '跳过', level: 0 },
};
export const LABEL_ORDER = ['follow', 'normal', 'skip'];

/** probs = {skip, normal, follow}; asymmetric: follow needs P(follow)>=followMin, skip needs P(skip)>=skipMin. */
export function decideLabel(probs, thresholds = DEFAULT_THRESHOLDS) {
  const t = { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) };
  if (probs.follow >= t.followMin) return 'follow';
  if (probs.skip >= t.skipMin) return 'skip';
  return 'normal';
}

export function probsFromScoreAnswer(answer) {
  const p = answer?.probabilities || {};
  const skip = num(p['0']);
  const normal = num(p['1']);
  const follow = num(p['2']);
  const sum = skip + normal + follow;
  if (!(sum > 0)) throw new Error('score answer has no probabilities');
  return { skip: skip / sum, normal: normal / sum, follow: follow / sum };
}

export const UNSURE_MAX_PROB = 0.6;

/** Builds one verdict for paper i from a Jev answers map. reasonKeys: extra Noul ids (e.g. ['topic','method','material']). */
export function verdictFromAnswers(answers, i, thresholds, meta = {}, reasonKeys = []) {
  const scoreAns = answers[`paper_${i}_priority`];
  if (!scoreAns || scoreAns.probabilities == null) throw new Error(`missing answer paper_${i}_priority`);
  const probs = probsFromScoreAnswer(scoreAns);
  const reviewAns = answers[`paper_${i}_review`];
  const reasons = {};
  for (const k of reasonKeys) {
    const a = answers[`paper_${i}_${k}`];
    if (a && typeof a.noul === 'number') reasons[k] = a.noul;
  }
  return {
    label: decideLabel(probs, thresholds),
    probs,
    score: num(scoreAns.score),
    confidence: num(scoreAns.confidence),
    unsure: Math.max(probs.skip, probs.normal, probs.follow) < UNSURE_MAX_PROB,
    reviewProb: reviewAns && typeof reviewAns.noul === 'number' ? reviewAns.noul : null,
    reasons: Object.keys(reasons).length ? reasons : null,
    model: meta.model || null,
    ts: meta.ts || Date.now(),
    manual: null,
  };
}

/** Reason keys whose probability clears the bar, in declaration order. */
export function matchedReasons(verdict, min = 0.5) {
  return Object.entries(verdict?.reasons || {}).filter(([, p]) => p >= min).map(([k]) => k);
}

/** The label the UI should show: manual override wins. */
export function effectiveLabel(verdict) {
  return verdict?.manual || verdict?.label || null;
}

/** Click cycles follow -> normal -> skip -> follow; resetting to the AI label is a separate action. */
export function nextManualLabel(current) {
  const idx = LABEL_ORDER.indexOf(current);
  return LABEL_ORDER[(idx + 1) % LABEL_ORDER.length];
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
