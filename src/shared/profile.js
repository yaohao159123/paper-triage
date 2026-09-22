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
