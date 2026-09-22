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

/** Why a paper matters, split into the three profile dimensions so the UI can show "命中：课题 · 材料". */
export const PAPER_REASONS = {
  topic: {
    zh: '课题',
    instructions: (i) => `Is the main subject of \`papers[${i}]\` (judged from its title and abstract_or_snippet) one of \`researcher.core_topics\`, or a major part of one of them?`,
    criteria: { true: 'The paper\'s main question or a major part of it is one of the listed core topics.', false: 'The paper only mentions a listed topic in passing, or addresses none of them.' },
  },
  method: {
    zh: '方法',
    instructions: (i) => `Does \`papers[${i}]\` use, develop, or evaluate one of \`researcher.methods\` (the measurement, simulation, or analysis techniques listed)?`,
    criteria: { true: 'One of the listed techniques is used or studied in the paper.', false: 'None of the listed techniques appears, or only a generic mention.' },
  },
  material: {
    zh: '材料',
    instructions: (i) => `Does \`papers[${i}]\` study one of \`researcher.materials\` or a close equivalent of the same class (for example another lignocellulosic biomass, another steelmaking dust, another iron oxide)?`,
    criteria: { true: 'A listed material or a same-class equivalent is a studied material in the paper.', false: 'The materials studied are unrelated to the list.' },
  },
};

export function buildTriageQuestions(count, { reasons = true } = {}) {
  const q = {};
  for (let i = 0; i < count; i += 1) {
    q[`paper_${i}_priority`] = { type: 'score', instructions: priorityInstructions(i), criteria: PRIORITY_LEVELS };
    q[`paper_${i}_review`] = {
      type: 'noul',
      instructions: reviewInstructions(i),
      criteria: { true: 'Review, survey, overview, perspective or tutorial article.', false: 'Original research article, case study, dataset or method paper.' },
    };
    if (reasons) for (const [k, r] of Object.entries(PAPER_REASONS)) q[`paper_${i}_${k}`] = { type: 'noul', instructions: r.instructions(i), criteria: r.criteria };
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

export const TWEET_REASONS = {
  interest: {
    zh: '主题',
    instructions: (i) => `Is the topic of \`tweets[${i}]\` one of \`reader.interests\`?`,
    criteria: { true: 'The tweet is about one of the listed interests.', false: 'The tweet is about something else.' },
  },
  concrete: {
    zh: '具体',
    instructions: (i) => `Does \`tweets[${i}]\` contain concrete information a reader could act on or verify: a specific technique, number, configuration, step, or first-hand observation with specifics?`,
    criteria: { true: 'Contains at least one specific, checkable piece of information.', false: 'Only opinion, reaction, hype, or vague statements.' },
  },
  source: {
    zh: '来源',
    instructions: (i) => `Does \`tweets[${i}]\` link to or explicitly name a primary source such as a paper, code repository, dataset, documentation page, or official report?`,
    criteria: { true: 'A primary source is linked or named.', false: 'No primary source; at most a vague reference.' },
  },
};

export function buildTweetQuestions(count, { reasons = true } = {}) {
  const q = {};
  for (let i = 0; i < count; i += 1) {
    q[`paper_${i}_priority`] = { type: 'score', instructions: tweetInstructions(i), criteria: TWEET_LEVELS };
    q[`paper_${i}_review`] = {
      type: 'noul',
      instructions: tweetNoiseInstructions(i),
      criteria: { true: 'Mainly promotional, advertising, or engagement bait.', false: 'Mainly informational, even if it links to the author\'s own work.' },
    };
    if (reasons) for (const [k, r] of Object.entries(TWEET_REASONS)) q[`paper_${i}_${k}`] = { type: 'noul', instructions: r.instructions(i), criteria: r.criteria };
  }
  return q;
}

/** Domain registry: which state/questions builder and chip text apply. */
export const DOMAINS = {
  paper: { buildState: buildTriageState, buildQuestions: buildTriageQuestions, chip: '综述', chipTitle: 'Jev 认为这是综述 / 评述类文章', reasons: PAPER_REASONS },
  tweet: { buildState: buildTweetState, buildQuestions: buildTweetQuestions, chip: '推广', chipTitle: 'Jev 认为这条主要是推广 / 引流内容', reasons: TWEET_REASONS },
};

/** Reason labels (key -> 中文) for a domain, used by the renderer. */
export function reasonLabels(domain) {
  const r = (DOMAINS[domain] || DOMAINS.paper).reasons;
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.zh]));
}

/* ---------- Xiaohongshu posts: judged from title (+ author, + body on the note page) ---------- */
import { xhsProfileForState } from './profile.js';

export const XHS_LEVELS = [
  // level 0 -> 跳过（屏蔽）
  'Hide: not learning content, or learning content clearly outside reader.interests. Lifestyle, shopping, fashion, food, travel, dating, entertainment, memes, ads, or vague motivational posts with nothing to learn.',
  // level 1 -> 普通
  'Normal: learning-oriented but weak: generic study tips, a topic only loosely related to reader.interests, or a title that promises knowledge without indicating any concrete content.',
  // level 2 -> 关注
  'Learn: educational content on one of reader.interests with something concrete to learn: a tutorial, an explanation of a concept or tool, a step-by-step method, notes on a paper or course, a comparison with specifics. The reader would open it to study.',
];

export function xhsInstructions(i) {
  return {
    question: `Is \`posts[${i}]\` learning content the reader described in \`reader\` should open?`,
    how_to_judge:
      `Judge from \`posts[${i}].title\` and, when present, \`posts[${i}].body\` and \`posts[${i}].author\`. The title is often the only text; read it literally and infer the post's topic from it. ` +
      'Titles are mostly in Chinese; understand them as written. Compare the topic with reader.interests and reader.noise. Emojis and clickbait wording do not change the topic.',
  };
}

export function xhsAdInstructions(i) {
  return `Is \`posts[${i}]\` mainly promotional: selling a course, product or service, a shopping recommendation, an affiliate or discount post, or a brand advertisement?`;
}

export const XHS_REASONS = {
  interest: {
    zh: '主题',
    instructions: (i) => `Is the topic of \`posts[${i}]\` one of \`reader.interests\`?`,
    criteria: { true: 'The post is about one of the listed interests.', false: 'The post is about something else.' },
  },
  educational: {
    zh: '教学',
    instructions: (i) => `Is \`posts[${i}]\` educational in form: it teaches, explains, demonstrates, or summarises something (tutorial, how-to, notes, explanation, comparison)?`,
    criteria: { true: 'The post exists to teach or explain.', false: 'The post shares a mood, a look, a purchase, an opinion, or entertainment.' },
  },
  concrete: {
    zh: '干货',
    instructions: (i) => `Does the title or body of \`posts[${i}]\` indicate concrete content: a named tool, technique, step, number, resource, or specific result, rather than a vague promise?`,
    criteria: { true: 'Specific, checkable content is indicated.', false: 'Only vague or hype wording.' },
  },
};

export function postForState(p) {
  const out = { title: p.title };
  if (p.abstract && p.abstract !== p.title) out.body = p.abstract;
  if (p.authors) out.author = p.authors;
  return out;
}

export function buildXhsState(profile, posts) {
  return { reader: xhsProfileForState(profile), posts: posts.map(postForState) };
}

export function buildXhsQuestions(count, { reasons = true } = {}) {
  const q = {};
  for (let i = 0; i < count; i += 1) {
    q[`paper_${i}_priority`] = { type: 'score', instructions: xhsInstructions(i), criteria: XHS_LEVELS };
    q[`paper_${i}_review`] = {
      type: 'noul',
      instructions: xhsAdInstructions(i),
      criteria: { true: 'Mainly promotional or commercial.', false: 'Mainly sharing knowledge or experience, even if it names products.' },
    };
    if (reasons) for (const [k, r] of Object.entries(XHS_REASONS)) q[`paper_${i}_${k}`] = { type: 'noul', instructions: r.instructions(i), criteria: r.criteria };
  }
  return q;
}

DOMAINS.xhs = { buildState: buildXhsState, buildQuestions: buildXhsQuestions, chip: '广告', chipTitle: 'Jev 认为这条主要是推广 / 带货内容', reasons: XHS_REASONS, promoIsNoise: true };
DOMAINS.tweet.promoIsNoise = true;
