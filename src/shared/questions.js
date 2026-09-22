// Builds the Jev state + questions for one batch of papers.
// One Score (reading priority) and one Noul (is review) per paper; all evaluated in parallel
// against one state, as in https://docs.typesafe.ai/cookbooks/parallel_questions

import { profileForState } from './profile.js';

export const PRIORITY_LEVELS = [
  // level 0 -> 跳过
  'Skip: the paper\'s subject, method and materials have no meaningful overlap with the researcher\'s core_topics, methods or materials, or the paper falls under researcher.not_interested. Reading it would not help the researcher\'s work.',
  // level 1 -> 普通
  'Normal: partial overlap. The paper touches one of the researcher\'s topics, methods or materials, but its main question is different or only loosely related. Worth reading the abstract, not a must-read.',
  // level 2 -> 关注
  'Follow: strong overlap. The paper\'s main question, method or material is one of the researcher\'s core_topics, methods or materials, or it reports data the researcher\'s own work would directly use or cite. A must-read.',
];

export function priorityInstructions(i) {
  return {
    question: `How high a reading priority does \`papers[${i}]\` have for the researcher described in \`researcher\`?`,
    how_to_judge:
      `Judge only from \`papers[${i}].title\` and \`papers[${i}].abstract_or_snippet\`. If abstract_or_snippet is empty or very short, judge from the title alone. ` +
      'Compare the paper\'s subject, methods and materials with researcher.core_topics, researcher.methods and researcher.materials. ' +
      'A paper that belongs to researcher.not_interested is Skip even if it mentions microwaves. ' +
      'Do not reward the paper for being high quality or famous; only for being relevant to this researcher.',
  };
}

export function reviewInstructions(i) {
  return `Is \`papers[${i}]\` a review, survey, overview or perspective article that summarises existing literature, rather than an original research article reporting new experiments, models or data?`;
}

export function paperForState(p) {
  const out = { title: p.title, abstract_or_snippet: p.abstract || '' };
  if (p.venue) out.venue = p.venue;
  if (p.year) out.year = p.year;
  return out;
}

export function buildTriageState(profile, papers) {
  return {
    researcher: profileForState(profile),
    papers: papers.map(paperForState),
  };
}

export function buildTriageQuestions(count) {
  const q = {};
  for (let i = 0; i < count; i += 1) {
    q[`paper_${i}_priority`] = { type: 'score', instructions: priorityInstructions(i), criteria: PRIORITY_LEVELS };
    q[`paper_${i}_review`] = {
      type: 'noul',
      instructions: reviewInstructions(i),
      criteria: { true: 'Review, survey, overview, perspective or tutorial article.', false: 'Original research article, case study, dataset or method paper.' },
    };
  }
  return q;
}
