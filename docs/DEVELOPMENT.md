# Developer guide

Technical reference for Planur. For an overview and quick start, see the
[README](../README.md).

## Repo layout

```
src/engine/    pure, UI-free constraint engine
  rules.js         registry of every rule (id → title + policy text)
  model.js         plan shape, courseMeta (lock/reason), evaluation context
  progress.js      deterministic greedy requirement-fill assignment
  candidates.js    which courses can satisfy a group (search UI + autogen)
  equivalency.js   "A instead of B" path groups
  autogen.js       auto-generate scheduler (greedy + bounded backtracking)
  grades.js        course status, grade points and GPA
  whatIf.js        what-if audits and closest-to-finishing suggestions
  constraints.js   every check, plus checkAll
src/data/      generated JSON (courses, programs, clusters, policy, meta, …)
src/storage/   dataStore.js (the only module that touches browser storage),
               account.js + sync.js + cloud/ for optional Google sign-in sync
src/ui/        React components (Tailwind v4)
tests/         vitest suites
tools/         Python data pipeline
  build_data.py           regenerates src/data/* from data-src/
  cdcs_harvest_all.py     refreshes the full course catalog from CDCS
  parse_cdcs_prereqs.py   extracts prerequisites from the CDCS harvest
  crawl_requirements.py   snapshots department requirement pages into data-src/pages/
  crawl_extra.py, fetch_missing.py   add pages the main crawler misses (merge, never overwrite)
  page_text.py            prints a snapshot's readable text (use --full when encoding)
  gen_bio_programs.py, extract_bio_diversification.py   Biology program generator
  rmp_scraper.py          RateMyProfessors data
  validate_programs.py    data linter: ERRORs fail, warnings are the review queue
  coverage.py             writes data-src/COVERAGE.md
  make_artifact.py        dist/index.html → dist/artifact.html
data-src/      raw sourced data (provenance), programs/*.json, pages/ snapshots,
               COVERAGE.md, TEMPLATE.program.json
```

## Commands

```bash
npm run dev                                    # dev server
npm test                                       # vitest
npm run build                                  # single-file dist/index.html
python3 tools/build_data.py && npm run build   # after editing data
python3 tools/make_artifact.py                 # artifact-format output
```

Plans save to localStorage when the app runs as a normal web page, and to
`window.storage` inside the artifact runtime. Google sign-in appears only when
Firebase is configured (the `VITE_FIREBASE_*` values in `.env.example`, plus
`firestore.rules`); `VITE_CLOUD=demo` tries it without Firebase.

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
majors), `allowedClusterDivisions`, `totalCreditsOverride` (e.g. BME 132),
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

## Course status, grades and GPA

Each placed course has a status: **planned** (default), **in progress**, or
**completed**, set from the card or with a semester's "Mark completed".
Completed courses can carry a grade. Everything lives in `courseMeta`
(`status`, `grade`) and the helpers are in `src/engine/grades.js`.

- Grade points use the College scale from the
  [Undergraduate Bulletin](https://www.rochester.edu/bulletin/college/grading.html):
  A 4.0, A- 3.7, B+ 3.3, B 3.0, B- 2.7, C+ 2.3, C 2.0, C- 1.7, D+ 1.3, D 1.0,
  D- 0.7, E 0.0. P, S, F, W, I and XF carry no grade points. Transfer and AP/IB
  credit never counts in the GPA.
- Completed courses with E, XE, F, XF, W or I earn no credit. They drop out
  of requirement fill and total hours (`buildContext`), with a
  `GRADE_NO_CREDIT` warning.
- `MAJOR_GPA_MIN`: GPA in the courses the audit assigned to a program, minus
  `ancillary` groups, against the program's `minMajorGPA`. It's a warning while
  counted courses are still ungraded, and an error once the program is complete
  and fully graded. `CUMULATIVE_GPA_MIN` warns below 2.0 overall.
- Completed and in-progress courses are locked, and auto-generate never
  removes them even if unlocked.
- Grade checks only fire once grades are entered. Grades are student-entered
  and unofficial.

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
only file in the codebase that touches browser storage: the artifact runtime's
`window.storage` when present, otherwise `localStorage` (keys prefixed
`planur:`). UI components and the engine never touch storage directly (the
engine stays pure and receives data as parameters). Plans autosave shortly
after each edit. Optional Google sign-in sync sits on top of this in
`src/storage/account.js`.

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

## Known open items

Also flagged in-app.

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

