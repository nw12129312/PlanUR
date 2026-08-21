// Named concentrations that live as separate program IDs, plus helpers to
// swap one for another on a plan. In-major pathways (PSC, BME, DSC, …) use
// track_n_of + trackChoices instead; this module is only the family switcher.

export const PROGRAM_FAMILIES = [
  {
    id: 'biology',
    noun: 'Track',
    members: [
      'biol-ba',
      'biol-bs-general',
      'biol-bs-biochem',
      'biol-bs-celldev',
      'biol-bs-compbio',
      'biol-bs-ecoevo',
      'biol-bs-microbio',
      'biol-bs-molgen',
      'biol-bs-neuro',
      'biol-bs-clintrans',
    ],
  },
  {
    id: 'business',
    noun: 'Concentration',
    members: [
      'major-bus-bs',
      'major-bus-acc-bs',
      'major-bus-ba-bs',
      'major-bus-ent-bs',
      'major-bus-fin-bs',
      'major-bus-is-bs',
      'major-bus-mkt-bs',
    ],
  },
  {
    id: 'english',
    noun: 'Concentration',
    members: [
      'major-engl-ba',
      'major-engl-cw-ba',
      'major-engl-lmc-ba',
      'major-thtr-ba',
    ],
  },
  {
    id: 'dance',
    noun: 'Concentration',
    members: ['major-danc-cep-ba', 'major-danc-ds-ba'],
  },
  {
    id: 'film',
    noun: 'Track',
    members: ['major-fmst-theory-ba', 'major-fmst-production-ba'],
  },
  {
    id: 'gsws',
    noun: 'Track',
    members: ['major-gsws-h-ba', 'major-gsws-ss-ba'],
  },
  {
    id: 'religion',
    noun: 'Track',
    members: ['major-relc-ba', 'major-relps-ba'],
  },
  {
    id: 'aths',
    noun: 'Track',
    members: ['major-aths-a-ba', 'major-aths-b-ba'],
  },
];

const FAMILY_BY_PROGRAM = new Map();
for (const family of PROGRAM_FAMILIES) {
  for (const id of family.members) FAMILY_BY_PROGRAM.set(id, family);
}

export function familyForProgram(programId) {
  return FAMILY_BY_PROGRAM.get(programId) || null;
}

export function withProgramSwap(plan, fromId, toId) {
  if (!fromId || !toId || fromId === toId) return plan;
  const occupied = [...(plan.majorIds || []), ...(plan.minorIds || [])]
    .filter((id) => id !== fromId);
  if (occupied.includes(toId)) return plan;
  const swap = (ids) => (ids || []).map((id) => (id === fromId ? toId : id));
  const trackChoices = { ...(plan.trackChoices || {}) };
  if (trackChoices[fromId]) {
    trackChoices[toId] = { ...(trackChoices[toId] || {}), ...trackChoices[fromId] };
    delete trackChoices[fromId];
  }
  return {
    ...plan,
    majorIds: swap(plan.majorIds),
    minorIds: swap(plan.minorIds),
    trackChoices,
  };
}
