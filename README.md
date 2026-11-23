# UR Schedule Builder

A constraint-based, multi-semester degree planner for University of Rochester
students: pick a major (optionally a second major or minors) and clusters, drag
courses into an 8-semester grid, and get a live audit against the Rochester
Curriculum rules — prerequisites, offering terms, credit loads, overlap caps,
cluster division rules, the Primary Writing Requirement, and total credit hours.

**Live app:** https://claude.ai/code/artifact/309ebba5-54cd-4feb-bd88-c2f1dba3b6cd

> Not an official degree audit. Data was sourced from official UR pages on
> 2026-07-03 and every unverified field is flagged in-app; confirm plans with
> your adviser.

---

## Data coverage — what is real and what is not

| Data | Status | Source |
|---|---|---|
| **CS BS major** | ACTIVE (fully entered) | [cs.rochester.edu BS requirements](https://www.cs.rochester.edu/undergraduate/bs-requirements.html) |
| **Biology BA major** | ACTIVE (fully entered) | [sas.rochester.edu/bio BA page](https://www.sas.rochester.edu/bio/undergraduate/bio.html) |
| **Political Science BA major** | ACTIVE (fully entered, incl. all 6 track course lists) | [PSC BA page](https://sas.rochester.edu/psc/undergraduate/major-psc-ba.html) + [tracks](https://www.sas.rochester.edu/psc/courses/tracks.php?dept=psc) |
| **CS minor** | ACTIVE | [CS minor page](https://www.cs.rochester.edu/undergraduate/minor-clusters.html) |
| **Encoded majors** (24 beyond the pilots) | ACTIVE, each with per-group `sourceQuote`: CS BA, Economics BA, Financial Economics BA, Math BA/BS, Psychology BA, BCS BA/BS, Political Science BS, International Relations BA (own 3 sourced tracks), English (Brit/Amer Literature) BA, History BA, Philosophy BA, Mechanical Engineering BS, Biomedical Engineering BS | `data-src/programs/*.json` (snapshot path in each file) |
| **All 10 Biology programs** (2026-07-06) | ACTIVE with spec ids `biol-*`: BA, BSG, Biochemistry, Cell & Developmental, Computational, Ecology & Evolutionary, Microbiology (MBI 221W ULW override), Molecular Genetics, Neuroscience (BCS-administered page), Clinical & Translational Sciences. Cross-cutting: `apIbCreditExcluded`, `minMajorGPA: 2.0`, `minPctFromHomeInstitution: 50` (ancillary groups exempt). Per-track Fall/Spring diversification lists in `data-src/bio-diversification.json`; generator: `tools/gen_bio_programs.py`. Old `major-bio-*` ids migrate automatically on plan load. | Track pages under [bio/undergraduate](https://www.sas.rochester.edu/bio/undergraduate/majors.html) |
| **ASL, Black Studies, Linguistics** (2026-08-01) | ACTIVE — BA + minor for each, from the department requirement pages. Ambiguities are flagged in `notes` rather than guessed (ASL's last 2 of 8 electives; Black Studies' humanities-vs-social-sciences divisional split, which also makes its cluster divisions unenforceable) | `data-src/programs/{major-asl-ba,minor-asl,major-blst-ba,minor-blst,major-ling-ba,minor-ling}.json` |
| **Philosophy minors** (2026-08-01) | ACTIVE — the general minor plus all three specialty minors (History of Philosophy, Ethics in Philosophy, Philosophy of Science), all four from one department page | `data-src/programs/minor-phil*.json` |
| **25 other majors/minors** | `NEEDS_DATA_ENTRY` placeholders with source links; the UI says so and computes no progress. Requirement pages are snapshotted in `data-src/pages/` (429 pages, 54 departments) ready for encoding — see `data-src/COVERAGE.md` | — |
| **~85 CSV programs not yet modeled** | Present in `undergrad_requirements_FINAL.csv` but not in the app at all: languages, Music, Religion, Art History, Studio Arts, the EES and Public Health families, Statistics, Simon business, Eastman BM, Nursing, Warner, certificates. Source pages are crawled and local; encoding is the remaining work | `data-src/pages/` |
| **Clusters** | 198 real clusters parsed from the official 2025–26 listing; 190 fully structured, 8 flagged `PARTIAL_PARSE` | [Cluster Search Engine PDF](https://secure1.rochester.edu/registrar/CSE/) |
| **Courses** | **2,992 verified** (titles/credits/actual scheduled terms, Fall 2025 + Spring 2026 — the complete AS&E + Hajim catalog, 81 departments); 967 stubs remain for courses referenced by cluster/program lists but not scheduled in those terms (flagged `unsourced`) | [cdcs.ur.rochester.edu](https://cdcs.ur.rochester.edu/) |
| **Prerequisites** | Only officially stated ones are enforced as errors (CSC 171→172→173 C- chain, CSC 242, CSC 240, PSCI 205). Sequence-implied orderings (MATH/CHEM/BIOL chains) are encoded but downgraded to warnings with `prereqsVerified: false` | per-course `prereqSource` |
| **Policy rules** | Encoded verbatim from the confirmed project spec (128/136 totals, Hajim overrides, overlap caps + exemption list, cluster rules, PWR) | `src/data/policy.json` |

Known open items (also flagged in-app):

- Mechanical engineering total credit hours — **resolved: 128** (confirmed from the ME major page during Layer 3).
- Biomedical engineering total credit hours — the project spec said 131, but the **official BME requirements page states 132**; the app uses the sourced 132.
- Biology BA diversification electives — official list "varies by semester"; modeled as a
  filter (BIOL/BCH/MBI/NSCI 200+) and labeled NEEDS VERIFICATION.
- PSC BA team-learning group — modeled as PSCI/INTR 380–399 filter, labeled NEEDS VERIFICATION.
- Cluster home-department normalization (`H1ENG…` → ENGL) uses a rename table in
  `tools/build_data.py`; verify the mapping if the own-department rule matters for an edge case.
- Offering terms reflect what actually ran in 2025–26, so offering violations are
  **warnings**, not errors — patterns change year to year.
- Per-major double-major overlap overrides currently set for HLS and IPA (cap 2); add others as discovered.
- **Divisional coverage — Engineering question (NEEDS_VERIFICATION):** the
  selection-time coverage check (`src/engine/coverage.js`) warns when the
  chosen major/minor/cluster combination doesn't collectively touch
  Humanities, Social Sciences, and Natural Sciences (policy citation in the
  file header). Whether the **Engineering** division satisfies the Natural
  Sciences slot is **not confirmed** against UR policy — the check currently
  treats Engineering as its own category (flip
  `ENGINEERING_SATISFIES_NATURAL_SCIENCES` once confirmed), so engineering
  majors may see an advisory warning that doesn't apply to them. The warning
  is soft ("generally expects"), overridable at generate time, and never
  fires on a standalone single-program view.

## Repo layout

```
src/engine/        pure, UI-free constraint engine
  rules.js         registry of every rule (id → title + policy text) for traceability
  model.js         plan shape + courseMeta (lock/reason) + evaluation context
  progress.js      deterministic greedy requirement-fill assignment
  candidates.js    which courses can satisfy a group (shared by search UI + autogen)
  equivalency.js   "A instead of B" path groups: conflicts, level tags, blocked adds
  autogen.js       auto-generate scheduler (greedy + bounded backtracking)
  constraints.js   checkPrerequisites / checkOfferingSemester / checkCreditLoad /
                   checkOverlap / checkClusterRules / checkCompletion /
                   checkTotalCredits / checkDepartmentCap / checkAll
src/data/          generated JSON (courses, programs, clusters, policy, meta)
src/storage/       dataStore.js - the ONLY module that touches window.storage
                   (savePlan/loadPlan/listPlans/deletePlan/duplicatePlan, all
                   userId-first, + getPrograms/getCourses/getEquivalencyGroups
                   and sibling getters for bundled data)
src/ui/            React components (Tailwind v4, token-based light/dark theming)
tests/             vitest: 67 tests (engine, equivalency, autogen, diff/apply, render smoke)
tools/build_data.py        regenerates src/data/* from data-src/ raw captures
tools/cdcs_harvest_all.py  refreshes the FULL course catalog (one POST per
                           term, including summer: CDCS returns the whole
                           AS&E+Hajim term when posted with school=1 and an
                           empty department filter)
tools/crawl_requirements.py snapshots every department's requirement pages
                           into data-src/pages/ (+ manifest.json)
tools/validate_programs.py data linter: run after every data edit; ERRORs fail,
                           warnings are the review queue (stubs, sourceQuotes)
tools/coverage.py          writes data-src/COVERAGE.md (ACTIVE vs pending)
tools/make_artifact.py     dist/index.html → dist/artifact.html (artifact format)
data-src/          raw sourced data (provenance), pages/ snapshots,
                   COVERAGE.md, TEMPLATE.program.json
.toolchain/        vendored Node 22 (this machine had no Node installed)
```

## Running locally

```bash
export PATH="$PWD/.toolchain/node-v22.17.0-darwin-arm64/bin:$PATH"
npm run dev      # dev server
npm test         # vitest (26 tests)
npm run build    # single-file dist/index.html
python3 tools/build_data.py && npm run build   # after editing data
python3 tools/make_artifact.py                 # artifact-format output
```

`window.storage` only exists in the artifact runtime; locally the app shows the
non-blocking "persistent storage unavailable" banner and keeps working in-memory
— that is the designed degradation path, not a bug.

## Data schema

### Course (`src/data/courses.json`, keyed by `"DEPT NNN[W]"`)

```jsonc
{
  "id": "CSC 172", "dept": "CSC", "number": 172, "suffix": "",
  "title": "Data Structures & Algorithms",
  "credits": 4, "creditsVerified": true,
  "offered": ["fall", "spring"],   // terms it actually ran in harvested CDCS terms
  "offeredClaim": ["fall","spring"], // CDCS "Offered:" field (often broader; not the summer gate)
  "offeredVerified": true,
  "prereqs": [["CSC 171"]],        // CNF: every inner list is an OR-group
  "prereqsVerified": true,
  "prereqNote": "C- or better…", "prereqSource": "https://…",
  "description": "…", "source": "CDCS …", "stub": false
}
```

### Program (`src/data/programs.json`) — see `data-src/TEMPLATE.program.json`

Key fields: `type` (major/minor), `division`, `departments`, `status`
(`ACTIVE` | `NEEDS_DATA_ENTRY`), `clustersRequired` (1 for the Hajim exception
majors), `allowedClusterDivisions`, `totalCreditsOverride` (e.g. BME 131),
`overlapCapOverride` (e.g. HLS/IPA 2), `programChecks`
(totalCourses / minFromDepts / max100Level), `requirementGroups[]`, and
`upperLevelWriting`.

Rule types: `all_of`, `n_of`, `sequence_one_of`, `n_from_filter`
(depts/number-range/credits/W-only/exclusions), `track_n_of` (PSC core),
`breadth_outside_track`. The template file documents each.

### Cluster (`src/data/clusters.json`)

```jsonc
{
  "id": "H1ENG015", "name": "Creative Writing", "division": "humanities",
  "homeDept": "ENG", "homeDeptCourseDepts": ["ENGL","ENG"],
  "status": "ACTIVE" /* or PARTIAL_PARSE */, "sourceUrl": "…",
  "groups": [{ "n": 3, "all": false, "unit": "courses" /* or credits */,
               "note": null,
               "options": [{ "codes": ["ENGL 121"], "mode": "any", "text": "ENGL 121: …" }] }]
}
```

### Policy (`src/data/policy.json`)

The confirmed UR rules as data: credit totals, overlap caps, the configurable
overlap-exemption course list, cluster rules (min courses, 2-unique rule,
WRTG/AP-IB/transfer exclusions), PWR satisfaction combos, credit-load bounds.

## Adding a program (no app-code changes)

1. Read the program's snapshot under `data-src/pages/<dept>/` (see `manifest.json`
   for titles/URLs; every placeholder's pages are already downloaded).
2. Copy `data-src/TEMPLATE.program.json`; fill it, quoting the page verbatim in
   each group's `sourceQuote`.
3. In `tools/build_data.py`, replace the matching placeholder (same `id`) or
   append to the programs list. Courses referenced by hand-entered lists that
   aren't in the harvested schedules become flagged stubs automatically.
4. `python3 tools/build_data.py && python3 tools/validate_programs.py && npm test`
   — the linter must report 0 errors; its stub warnings are your verify list.
5. `npm run build && python3 tools/make_artifact.py`, then redeploy.
6. `python3 tools/coverage.py` to refresh the coverage table.

## Equivalency groups

`src/data/equivalency_groups.json` models "A **instead of** B" alternatives —
never prerequisites. Each group has paths; a plan may follow at most one path
per group, and a resolved group counts as **one** fulfillment of its
`satisfiesPrereqLevel` tag regardless of which path was taken.

Sourced groups (ACTIVE): **Calculus sequence** — MATH 141-143 / 161-162 /
Honors 171-172 (from the CS BS page's "Either MATH 14x, MATH 16x, or MATH 17x
sequence"; note this replaces the project spec's illustrative "MATH 171 alone"
with the sourced sequence, so the honors terminal course is MATH 172);
**Introductory biology** — BIOL 110L-111L / 112L-113L (Biology BA page);
**Organic chemistry I** (`orgo_sequence_complete`) — CHEM 203+207 /
first-year CHEM 171+173 (Biology pages); **Intro physics**
(`physics_intro_complete`) — PHYS 113 / 121 / honors 141 (judgment call:
sourced from the Biology pages' "one of the following physics I courses",
not from the Physics department's own page — see comment in build_data.py).
Biology's calculus requirement is a Calc-I-level `n_of` (one course), NOT the
sequence-complete level tag — the calc-sequence group still guards against
mixing 141/161/171 paths, unmodified. Intro chemistry / statistics remain
`NEEDS_DATA_ENTRY` with empty paths until confirmed against a source.

Engine (`src/engine/equivalency.js`, all pure):

- `checkEquivalencyConflicts(plan, equivalencyGroups)` — flags any plan whose
  placed courses (transfer credit included) can't be explained by a single
  path; one violation per conflicting course so each card shows it inline.
  Runs inside `checkAll`, so it fires on every add/remove/move like every
  other check.
- `checkPrerequisites` now resolves `"level:<tag>"` prereq entries: satisfied
  when the terminal course of any one path of the matching group is placed
  earlier (MATH 143 **or** MATH 172 — either, not both, not neither).
- `conflictForAdd(plan, courseId, groups)` — the blocking pre-check the UI
  runs before a manual add: cross-path adds are refused with an explanation
  ("MATH 171 already commits your Calculus sequence to the Honors path…")
  instead of a red border after the fact.

Auto-generate treats groups as hard constraints: any locked, manual, or
transfer course from a group resolves the whole group's path choice, and
cross-path courses become ineligible. When a genuine choice exists, the
generator resolves it once, deterministically — next course offered this term,
then lighter total credits — or prefers `accelerated: true` paths when the
"Prefer accelerated paths" toggle is on. The chosen path is traceable in the
placement reasons ("… · Calculus sequence: MATH 161-162 path") and in a
generation note; retry backtracking can switch paths if a choice proves
invalid. In course search, group members display together under a
"⇌ alternatives — choose one path" section, labeled by path, and every member
course carries a group badge on its card.

## Auto-generate

`src/engine/autogen.js` exports `autoGenerate(plan, data, { scope, targetLoad,
maxLoad, maxRetries })` → `{ plan, placements, warnings, infeasible, violations,
attempts }`. It is pure and re-implements no rules: requirement status comes
from `computeProgress()`, candidates from `candidates.js` (shared with the
search UI), and every generated plan is accepted only after `checkAll()` — the
same validators the UI runs.

How a pass works:

1. Strip removable courses (unlocked + in scope; locked and manual courses are
   never touched — legacy plans without `courseMeta` default to locked).
2. Rebuild the requirement ledger **each semester** from real engine progress,
   so the scheduler can't drift from what the validators count. Missing
   prerequisite chains are pulled in as `Prerequisite for X` support entries.
3. Fill semesters left-to-right toward the target load (default 16, cap 18),
   scoring candidates by: chains that must start now to fit → single-purpose
   courses before flexible ones → courses that gate the most downstream
   prerequisites → scarce offerings in their scarce term → verified data before
   stubs → deterministic id tie-break. WRTG 105 is forced into the first scoped
   semester unless transfer credit covers it.
4. Validate with `checkAll`. If an error implicates a *flexible* auto choice,
   that course is banned and the pass reruns (bounded by `maxRetries`, default
   50). Two guards keep a retry from becoming a dead end: a placement that
   satisfies a non-flexible entry (`all_of` / `sequence_one_of` member,
   prerequisite support, PWR) is marked `mandatory` and is never banned, and no
   ban may leave a requirement group with fewer surviving options than it needs.
   If retries exhaust, the best partial plan is returned with its remaining
   violations listed — never silently.
5. Anything unplaceable is reported with a diagnosis: the blocking prerequisite
   chain ("CSC 171 → CSC 172 → CSC 173 … start it by semester N"), an offering
   mismatch, or a capacity limit. Compound cluster options ("CHIN 114 and 115")
   are left for manual placement and said so.

**Course order follows published prerequisites.** A course may not sit in the
   same semester as, or earlier than, a prerequisite it lists. Catalog numbers
   within a department are not treated as an ordering rule — UR numbering is
   only a convention, and the CDCS prereq scrape is the source of truth.

Scopes: `{kind:'all'}` (everything unlocked) · `{kind:'fromSemester', index}`
(earlier semesters untouched) · `{kind:'program', programId}` (only courses used
solely by that program) · `{kind:'group', programId, groupId}` (purely additive
single-gap fill — the checklist's "⚡ fill" buttons).

Every auto-placed course carries `courseMeta[cid] = { source:'auto',
locked:false, reason }`; the reason shows as a ⚡ tag on the card. Manual
adds/drags are `source:'manual', locked:true`. Locks toggle per card (🔒), or
globally via Lock all / Unlock all. Results are applied through a diff modal
(added / moved / removed, each individually accept-or-rejectable) — generation
never mutates the plan directly.

## How violations work

Every check returns `{ ruleId, severity, message, courseId?, semesterId?,
programId?, clusterId? }`. `ruleId` resolves through `src/engine/rules.js`, so
each flag in the UI shows the policy text it derives from (hover any chip).
Severities: `error` = breaks a confirmed rule · `warning` = likely problem or
unverified data · `info` = progress/awareness.

Requirement assignment is a deterministic greedy fill (groups in listed order;
clusters prefer courses unused by programs and cap program-shared courses at 1)
so every count in the audit is explainable; it does not search for a globally
optimal assignment in pathological overlap cases.

## Storage

All persistence flows through one module: `src/storage/dataStore.js`. It is the
only file in the codebase that calls `window.storage` (the artifact runtime's
per-user store — never localStorage); UI components and the engine never touch
storage directly (the engine stays pure and receives data as parameters).

API: `savePlan(userId, plan)`, `loadPlan(userId, planId)`, `listPlans(userId)`,
`deletePlan(userId, planId)`, `duplicatePlan(userId, planId)` — every
plan-related function takes `userId` first, defaulting to the `LOCAL_USER`
placeholder, so real multi-user accounts later change no signatures. Bundled
data is served by `getPrograms()`, `getCourses()`, `getEquivalencyGroups()`
(plus `getClusters()`, `getPolicy()`, `getMeta()`). Renaming is a
load-plus-save composition rather than a separate primitive.

Key scheme (internal to dataStore): the local user keeps the legacy keys
`plans:{plan_id}` / `plan-index` so plans saved by earlier versions remain
readable without migration; any other userId is namespaced as
`users:{userId}:plans:{plan_id}` / `users:{userId}:plan-index`.

All stored shapes (Plan, index entries) are plain JSON-serializable objects
with no framework- or storage-specific fields. The access layer
feature-detects `get/set/delete` vs `getItem/setItem/removeItem` shapes,
awaits thenables, wraps every call in try/catch, and mirrors writes into
memory so a storage outage degrades to a visible banner instead of data loss
mid-session (`storageStatus()` / `subscribeStorageStatus()`).
