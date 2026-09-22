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

/* ---------- Tweets ---------- */
import { tweetProfileForState } from './profile.js';

export const TWEET_LEVELS = [
  // level 0 -> 跳过
  'Skip: no value for the reader. Advertising, giveaways, engagement bait, memes, personal chit-chat, sports, political or celebrity outrage, vague hype or opinion with no concrete information, or a topic outside reader.interests.',
  // level 1 -> 普通
  'Normal: touches one of reader.interests but offers little the reader can act on: a short reaction, a hot take, a re-share without added detail, or news the reader would see anyway.',
  // level 2 -> 关注
  'Follow: directly useful on one of reader.interests. Contains concrete, actionable information matching reader.useful_signals: a new tool, model, paper, dataset or release with a link or details; a technique, configuration or benchmark number; a first-hand observation with specifics; or a faithful summary of a primary source. The reader would save it or act on it.',
];

export function tweetInstructions(i) {
  return {
    question: `How useful is \`tweets[${i}]\` to the reader described in \`reader\`?`,
    how_to_judge:
      `Judge only from \`tweets[${i}].text\` (and \`tweets[${i}].quoted_text\` if present). Compare the tweet's topic with reader.interests, the presence of concrete information with reader.useful_signals, and check reader.noise. ` +
      'A famous author or many likes do not make a tweet useful; only its content does. A tweet that is mostly a link with a clear description of a relevant resource counts as concrete information.',
  };
}

export function tweetNoiseInstructions(i) {
  return `Is \`tweets[${i}]\` mainly promotional, advertising, or engagement bait (selling something, farming likes/follows/replies, referral or affiliate links, giveaways) rather than sharing information?`;
}

export function tweetForState(t) {
  const out = { text: t.abstract || t.title || '' };
  if (t.authors) out.author = t.authors;
  if (t.quotedText) out.quoted_text = t.quotedText;
  return out;
}

export function buildTweetState(profile, tweets) {
  return { reader: tweetProfileForState(profile), tweets: tweets.map(tweetForState) };
}

export function buildTweetQuestions(count) {
  const q = {};
  for (let i = 0; i < count; i += 1) {
    q[`paper_${i}_priority`] = { type: 'score', instructions: tweetInstructions(i), criteria: TWEET_LEVELS };
    q[`paper_${i}_review`] = {
      type: 'noul',
      instructions: tweetNoiseInstructions(i),
      criteria: { true: 'Mainly promotional, advertising, or engagement bait.', false: 'Mainly informational, even if it links to the author\'s own work.' },
    };
  }
  return q;
}

/** Domain registry: which state/questions builder and chip text apply. */
export const DOMAINS = {
  paper: { buildState: buildTriageState, buildQuestions: buildTriageQuestions, chip: '综述', chipTitle: 'Jev 认为这是综述 / 评述类文章' },
  tweet: { buildState: buildTweetState, buildQuestions: buildTweetQuestions, chip: '推广', chipTitle: 'Jev 认为这条主要是推广 / 引流内容' },
};
