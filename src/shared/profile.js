// Researcher profile: the part of the state that describes whom we triage for.
// Written in English on purpose: Jev's accuracy is best in English (docs: /models#language-support).

export const DEFAULT_PROFILE = {
  summary:
    'PhD researcher in process metallurgy (University of Oulu). Works on microwave dielectric properties and microwave heating of biomass and steelmaking by-products, and on using them for low-carbon metal recovery and ironmaking.',
  core_topics: [
    'microwave dielectric properties (permittivity, loss factor, penetration depth) of biomass, biochar, ores, slags and dusts',
    'microwave heating, microwave-assisted reduction, pyrolysis, roasting and drying of minerals and biomass',
    'recycling of steelmaking by-products (EAF dust, BOF sludge, mill scale) and zinc recovery',
    'carbothermic and hydrogen reduction of iron oxides using biomass or biochar as reductant',
    'low-carbon ironmaking and steelmaking; biomass as a substitute for fossil carbon',
  ],
  methods: [
    'cavity perturbation and open-ended coaxial probe dielectric measurement versus temperature',
    'multiphysics simulation of microwave heating (electromagnetic + heat transfer, COMSOL)',
    'thermogravimetric kinetic analysis (model-fitting and isoconversional methods)',
    'XRD, SEM-EDS and chemical characterisation of reduction and pyrolysis products',
  ],
  materials: [
    'lignocellulosic biomass and biochar',
    'electric arc furnace dust (EAFD), zinc ferrite, iron ore and iron oxides',
    'metallurgical slags, sludges and dusts',
    'coke and coal (as comparison reductants)',
  ],
  not_interested: [
    'microwave antennas, circuits, radar, 5G/6G communications and signal processing',
    'microwave medical imaging or therapy',
    'microwave cooking of food, unless it reports dielectric property data of plant materials',
    'pure software, finance, or social-science topics',
  ],
};

export const DEFAULT_THRESHOLDS = { followMin: 0.5, skipMin: 0.6 };
export const DEFAULT_BATCH_SIZE = 10;
export const DEFAULT_MODEL_NAME = 'jev-latest';

/** Text-area friendly (one item per line) <-> array. */
export function linesToList(text) {
  return String(text || '')
    .split(/\r?\n|;/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function listToLines(list) {
  return (list || []).join('\n');
}

export function profileForState(profile) {
  const p = { ...DEFAULT_PROFILE, ...(profile || {}) };
  const out = { summary: p.summary };
  for (const k of ['core_topics', 'methods', 'materials', 'not_interested']) {
    if (Array.isArray(p[k]) && p[k].length) out[k] = p[k];
  }
  return out;
}

const PROFILE_FIELDS = ['summary', 'core_topics', 'methods', 'materials', 'not_interested'];

/** FNV-1a over the judgment-relevant fields; verdict caches are namespaced by it so editing a profile invalidates them. */
export function profileHash(profile) {
  const p = profileForState(profile);
  const text = JSON.stringify(PROFILE_FIELDS.map((k) => p[k] ?? null));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function newProfileId() {
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** Migrates single-`profile` settings to `profiles` + `activeProfileId`; always returns a usable pair. */
export function ensureProfiles(settings = {}) {
  let profiles = Array.isArray(settings.profiles) ? settings.profiles.filter((p) => p && p.id) : [];
  if (!profiles.length) {
    profiles = [{ id: 'default', name: '默认画像', ...DEFAULT_PROFILE, ...(settings.profile || {}) }];
  }
  const activeProfileId = profiles.some((p) => p.id === settings.activeProfileId) ? settings.activeProfileId : profiles[0].id;
  return { profiles, activeProfileId };
}

export function activeProfile(settings) {
  const { profiles, activeProfileId } = ensureProfiles(settings);
  return profiles.find((p) => p.id === activeProfileId) || profiles[0];
}

/* ---------- Tweets: a separate interest profile ---------- */

export const DEFAULT_TWEET_PROFILE = {
  summary:
    'Reader is a PhD researcher in process metallurgy who also builds AI coding-agent tooling and a personal quant/crypto terminal. Wants tweets with concrete, actionable information, not opinions or hype.',
  interests: [
    'AI coding agents and LLM developer tooling (Claude Code, Codex, agent frameworks, MCP, prompt and context engineering, model releases and benchmarks)',
    'quantitative trading, crypto markets, macro data releases, exchange and on-chain infrastructure',
    'metallurgy, materials science, microwave processing, hydrogen ironmaking, biomass and decarbonisation research',
    'scientific tooling: literature search, reference managers, simulation software, reproducible research workflows',
    'open-source releases, datasets, papers and technical write-ups in the areas above',
  ],
  useful_signals: [
    'announces or explains a new tool, model, library, dataset or paper with a link to the primary source',
    'gives a concrete technique, configuration, benchmark number, or step-by-step how-to',
    'reports a first-hand observation with specifics (what was tried, what happened, numbers)',
    'summarises a long document or thread with the key facts preserved',
  ],
  noise: [
    'advertising, giveaways, referral links, paid courses, engagement bait ("like if…", "who else…"), follower-farming threads',
    'memes, jokes, personal life updates, sports, celebrity or political outrage',
    'vague hype, motivational quotes, opinions with no concrete information, "this changes everything" with no details',
    'crypto price shilling, pump calls, and airdrop spam',
  ],
};

const TWEET_FIELDS = ['summary', 'interests', 'useful_signals', 'noise'];

export function tweetProfileForState(profile) {
  const p = { ...DEFAULT_TWEET_PROFILE, ...(profile || {}) };
  const out = { summary: p.summary };
  for (const k of TWEET_FIELDS.slice(1)) if (Array.isArray(p[k]) && p[k].length) out[k] = p[k];
  return out;
}

export function tweetProfileHash(profile) {
  const p = tweetProfileForState(profile);
  const text = JSON.stringify(TWEET_FIELDS.map((k) => p[k] ?? null));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `t${h.toString(16).padStart(8, '0')}`;
}
