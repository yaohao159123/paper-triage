// Live evaluation of the triage judgment against Jev. Needs TYPESAFE_API_KEY (env, or ~/.claude/settings.json env block).
// Usage: npm run eval  [-- --scholar]   (adds the 10 papers from the Scholar fixture)
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { JSDOM } from 'jsdom';
import { askJev } from '../src/shared/jev.js';
import { buildTriageState, buildTriageQuestions, buildTweetState, buildTweetQuestions } from '../src/shared/questions.js';
import { verdictFromAnswers, LABELS } from '../src/shared/policy.js';
import { normalizePaper, chunk } from '../src/shared/paper.js';
import { DEFAULT_PROFILE, DEFAULT_TWEET_PROFILE, DEFAULT_THRESHOLDS, DEFAULT_BATCH_SIZE } from '../src/shared/profile.js';
import { scholarAdapter } from '../src/content/adapters/scholar.js';

function apiKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  try {
    return JSON.parse(readFileSync(`${homedir()}/.claude/settings.json`, 'utf8')).env?.TYPESAFE_API_KEY || '';
  } catch {
    return '';
  }
}

// expected: follow | normal | skip | null (no assertion)
const SAMPLES = [
  { expected: 'follow', title: 'Microwave dielectric properties of agricultural biomass at elevated temperatures for microwave-assisted pyrolysis', abstract: 'Complex permittivity of rice husk, corn stover and wheat straw was measured from 25 to 700 °C at 915 and 2450 MHz with the cavity perturbation method. Loss factor rises sharply above 350 °C as carbonisation proceeds; penetration depth and heating rate are discussed for reactor design.' },
  { expected: 'follow', title: 'Recovery of zinc from electric arc furnace dust by microwave-assisted carbothermic reduction using biochar', abstract: 'EAF dust mixed with pine biochar was reduced in a 2.45 GHz multimode cavity. Zinc volatilisation reached 96% at 1050 °C within 20 min; XRD showed zinc ferrite decomposition and metallic iron formation. Kinetic parameters were derived from TGA.' },
  { expected: 'follow', title: 'Hydrogen reduction kinetics of hematite pellets: isoconversional analysis and microstructure evolution', abstract: 'Reduction of hematite pellets in H2 between 700 and 1000 °C was followed thermogravimetrically. Activation energies from Friedman and KAS methods are compared and porosity evolution characterised by SEM.' },
  { expected: 'normal', title: 'Microwave-assisted pyrolysis of waste polypropylene for liquid fuel production', abstract: 'Waste polypropylene was pyrolysed in a microwave reactor with activated carbon as absorber. Oil yield reached 82 wt% and the effect of microwave power on product distribution is reported.' },
  { expected: 'normal', title: 'Dielectric properties of wheat flour and dough at 915 MHz and 2450 MHz as functions of moisture and temperature', abstract: 'Open-ended coaxial probe measurements of wheat flour and dough between 20 and 90 °C. Dielectric constant and loss factor increase with moisture; implications for radio-frequency pasteurisation are discussed.' },
  { expected: 'normal', title: 'Life cycle assessment of hydrogen-based direct reduced iron and electric arc furnace steelmaking in Europe', abstract: 'A cradle-to-gate LCA compares H2-DRI-EAF routes with the blast furnace route under several electricity mixes. Global warming potential falls by 60 to 90% depending on grid carbon intensity.' },
  { expected: 'skip', title: 'A 28 GHz phased-array antenna module with beam steering for 5G mobile terminals', abstract: 'A 4x4 patch antenna array with integrated phase shifters achieves 12 dBi gain and ±45° scanning. Measured S-parameters and radiation patterns are reported.' },
  { expected: 'skip', title: 'Deep learning for early detection of diabetic retinopathy from retinal fundus photographs', abstract: 'A convolutional neural network trained on 120,000 fundus images reaches an AUC of 0.97 for referable diabetic retinopathy.' },
  { expected: 'skip', title: 'Microwave ablation for hepatocellular carcinoma: a systematic review and meta-analysis', abstract: 'Thirty-two studies comparing microwave ablation with radiofrequency ablation were pooled. Microwave ablation showed lower local recurrence for tumours above 3 cm.' },
  { expected: 'skip', title: 'Transformer models for multivariate financial time series forecasting', abstract: 'We benchmark attention-based architectures against LSTM baselines on equity and FX returns.' },
  { expected: 'follow', title: 'Dielectric properties and microwave heating of oil palm biomass and biochar', abstract: '' },
  { expected: 'skip', title: 'Microwave hyperthermia applicator design for breast cancer treatment', abstract: '' },
];

const TWEETS = [
  { expected: 'follow', text: 'New write-up: how we cut agent context by 90% with per-tool-call pruning using a small typed-decision model instead of summaries. Code + evals: github.com/example/pruner' },
  { expected: 'follow', text: 'SSAB reported the first commercial HYBRIT fossil-free steel delivery: 2,000 t of DRI reduced with hydrogen at Luleå, 1.2 kg CO2/t steel measured. Report PDF: ssab.com/hybrit-report' },
  { expected: 'follow', text: 'Claude Code 2.1.278 changed how long Bash output is handled: anything over ~10k tokens is written to a file and the model only sees a 2 KB preview. If your hooks post-process tool output, read the file path from the event instead. Notes: example.dev/cc-278' },
  { expected: 'follow', text: 'US CPI came in at 2.4% y/y vs 2.6% expected; core 2.9%. Fed funds futures now price 2 cuts by December (was 1). BLS table: bls.gov/cpi' },
  { expected: 'normal', text: 'Honestly Claude Code is getting scary good. Wild times for software.' },
  { expected: 'normal', text: 'Anyone else find that most LLM eval papers are unreproducible? Feels like the field needs a reset.' },
  { expected: 'normal', text: 'Bitcoin back above 100k. Told you.' },
  { expected: 'skip', text: '🚀🚀 $MOON is going 100x this week. Like + RT and I will send 0.1 ETH to 5 random followers. Link in bio 🔥' },
  { expected: 'skip', text: 'Success is not final, failure is not fatal. Who needs to hear this today? 💪' },
  { expected: 'skip', text: 'My 7-figure course on AI automation is 50% off for the next 24 hours. DM me "AI" to get the link.' },
  { expected: 'skip', text: 'What a match last night!!! Arsenal 3-1, absolute scenes at the Emirates' },
  { expected: 'skip', text: 'The senator just embarrassed himself on live TV again. Unbelievable. Retweet if you agree.' },
];

async function evalTweets(key) {
  const samples = TWEETS.map((t) => ({ ...t, paper: normalizePaper({ title: t.text.slice(0, 120), abstract: t.text, source: 'x', tweetId: String(Math.random()).slice(2) }) }));
  const rows = [];
  let failures = 0;
  for (const batch of chunk(samples, DEFAULT_BATCH_SIZE)) {
    const state = buildTweetState(DEFAULT_TWEET_PROFILE, batch.map((s) => s.paper));
    const questions = buildTweetQuestions(batch.length);
    const t0 = performance.now();
    const res = await askJev({ apiKey: key }, state, questions);
    const ms = Math.round(performance.now() - t0);
    batch.forEach((s, i) => {
      const v = verdictFromAnswers(res.answers, i, DEFAULT_THRESHOLDS, { model: res.model });
      const ok = s.expected === v.label ? 'ok' : 'MISS';
      if (ok === 'MISS') failures += 1;
      rows.push({ label: LABELS[v.label].zh, ok, expected: s.expected, skip: pct(v.probs.skip), normal: pct(v.probs.normal), follow: pct(v.probs.follow), promo: pct(v.reviewProb), text: s.text.slice(0, 70) });
    });
    console.log(`tweet batch of ${batch.length}: ${ms} ms, tokens ${res.usage?.input_tokens ?? '?'}`);
  }
  console.table(rows);
  console.log(failures ? `${failures} tweet misses` : 'all tweet cases labelled as expected');
  return failures;
}

async function main() {
  if (process.argv.includes('--tweets')) {
    const key = apiKey();
    if (!key) throw new Error('no TYPESAFE_API_KEY');
    process.exit((await evalTweets(key)) ? 1 : 0);
  }
  const key = apiKey();
  if (!key) throw new Error('no TYPESAFE_API_KEY');
  let samples = SAMPLES.map((s) => ({ ...s, paper: normalizePaper(s) }));
  if (process.argv.includes('--scholar')) {
    const doc = new JSDOM(readFileSync(new URL('../tests/fixtures/scholar.html', import.meta.url), 'utf8')).window.document;
    for (const e of scholarAdapter.findEntries(doc)) samples.push({ expected: null, paper: normalizePaper(e.paper) });
  }
  const rows = [];
  let failures = 0;
  for (const batch of chunk(samples, DEFAULT_BATCH_SIZE)) {
    const state = buildTriageState(DEFAULT_PROFILE, batch.map((s) => s.paper));
    const questions = buildTriageQuestions(batch.length);
    const t0 = performance.now();
    const res = await askJev({ apiKey: key }, state, questions);
    const ms = Math.round(performance.now() - t0);
    batch.forEach((s, i) => {
      const v = verdictFromAnswers(res.answers, i, DEFAULT_THRESHOLDS, { model: res.model });
      const ok = s.expected == null ? '' : s.expected === v.label ? 'ok' : 'MISS';
      if (ok === 'MISS') failures += 1;
      rows.push({ label: LABELS[v.label].zh, ok, expected: s.expected || '-', skip: pct(v.probs.skip), normal: pct(v.probs.normal), follow: pct(v.probs.follow), conf: v.confidence.toFixed(2), review: v.reviewProb == null ? '-' : pct(v.reviewProb), title: s.paper.title.slice(0, 70) });
    });
    console.log(`batch of ${batch.length}: ${ms} ms, model ${res.model}, tokens ${res.usage?.input_tokens ?? '?'}`);
  }
  console.table(rows);
  console.log(failures ? `${failures} clear-case misses` : 'all clear cases labelled as expected');
  process.exit(failures ? 1 : 0);
}

const pct = (x) => `${Math.round(x * 100)}%`;
main().catch((e) => { console.error(e); process.exit(2); });
