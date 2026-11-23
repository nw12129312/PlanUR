import React, { useMemo, useState } from 'react';
import { Icon } from './icons.jsx';
import { Meter, SevChip, Tag, IconButton, Panel, Select } from './bits.jsx';
import { getTrackChoice } from '../engine/model.js';
import { familyForProgram } from '../engine/pathways.js';
import { describeRequirement } from '../engine/requirementOptions.js';
import { describeOptionAction } from '../engine/swapRequirement.js';
import { coversCourse } from '../engine/crossList.js';
import { ruleInfo } from '../engine/rules.js';
import { resolveRequiredCredits } from '../engine/constraints.js';
import { creditsByStatus, cumulativeGpa, formatGpa, programGpa } from '../engine/grades.js';

// How many options to render before collapsing the tail. ATHS electives has 92
// and LACX 73 — rendering those in full would swamp the rail.
const OPTION_CAP = 14;

// One course option inside an expanded requirement. Shows whether it is already
// in the plan, and offers a one-click add when it is not.
function OptionChip({ cid, data, placedSet, action, onPick }) {
  const c = data.courses[cid];
  const placed = coversCourse(placedSet, cid, data.courses);
  const swap = action?.kind === 'swap';
  return (
    <li className="flex items-center gap-1.5">
      <span className={`code shrink-0 rounded px-1 py-0.5 ${
        placed ? 'bg-good-soft text-good' : 'bg-surface text-ink-2'}`}>{cid}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-ink-3" title={c?.title || cid}>
        {c?.title || 'not in the 2025-26 catalog'}
      </span>
      {placed
        ? <Icon name="check" size="sm" className="shrink-0 text-good" label={`${cid} is in your plan`} />
        : onPick && (
          <IconButton
            icon={swap ? 'swap' : 'plus'}
            label={swap
              ? `Swap ${action.outgoing.join(' + ')} for ${action.incoming.join(' + ')}`
              : `Add ${cid}`}
            tone="accent" size="sm"
            className="h-5 w-5" onClick={() => onPick(cid)} />
        )}
    </li>
  );
}

function pathwayNoun(group, fallback = 'Concentration') {
  const t = `${group?.id || ''} ${group?.label || ''}`.toLowerCase();
  if (t.includes('theme')) return 'Theme';
  if (t.includes('emphasis')) return 'Emphasis';
  if (t.includes('focus')) return 'Focus area';
  if (t.includes('program of study')) return 'Program of study';
  if (t.includes('application')) return 'Application area';
  if (t.includes('concentration')) return 'Concentration';
  if (t.includes('track')) return 'Track';
  return fallback;
}

function choosePrompt(noun) {
  const n = noun.toLowerCase();
  const article = /^[aeiou]/.test(n) ? 'an' : 'a';
  return `Choose ${article} ${n}…`;
}

function PathwaySelect({ noun, label, value, names, onChange }) {
  return (
    <label className="mt-1 flex min-w-0 flex-col gap-0.5" onClick={(e) => e.preventDefault()}>
      <span className="label-caps">{noun}</span>
      <Select aria-label={label} value={value || ''} onChange={(e) => onChange?.(e.target.value)}>
        <option value="">{choosePrompt(noun)}</option>
        {names.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </Select>
    </label>
  );
}

function FamilyPicker({ family, program, programs, excludeIds, onSwapProgram }) {
  const options = family.members
    .map((id) => programs.find((p) => p.id === id))
    .filter(Boolean);
  return (
    <label className="mt-1 flex min-w-0 flex-col gap-0.5">
      <span className="label-caps">{family.noun}</span>
      <Select
        aria-label={`${family.noun} for ${program.name}`}
        value={program.id}
        onChange={(e) => onSwapProgram?.({ fromId: program.id, toId: e.target.value })}
      >
        {options.map((p) => (
          <option
            key={p.id}
            value={p.id}
            disabled={excludeIds?.includes(p.id) && p.id !== program.id}
          >
            {p.name} ({p.degree})
          </option>
        ))}
      </Select>
    </label>
  );
}

function OptionList({ courses, data, placedSet, actionFor, onPick }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? courses : courses.slice(0, OPTION_CAP);
  return (
    <>
      <ul className="space-y-0.5">
        {shown.map((cid) => (
          <OptionChip key={cid} cid={cid} data={data} placedSet={placedSet}
            action={actionFor?.(cid)} onPick={onPick} />
        ))}
      </ul>
      {courses.length > OPTION_CAP && (
        <button type="button" onClick={() => setShowAll((x) => !x)}
          className="mt-1 text-xs font-semibold text-accent hover:underline">
          {showAll ? 'Show fewer' : `Show all ${courses.length} options`}
        </button>
      )}
    </>
  );
}

// A requirement group: meter always visible, options on demand. Only groups
// that actually offer a choice get a disclosure — an all_of has nothing to pick.
function RequirementRow({ group: g, program, data, placedSet, onAutoFill, onPickOption, trackChoice, onChooseTrack }) {
  const spec = useMemo(() => {
    const src = g.id === '__ulw'
      ? { rule: program.upperLevelWriting?.rule }
      : (program.requirementGroups || []).find((x) => x.id === g.id);
    return src ? describeRequirement(src, data, { chosenTrack: g.chosenTrack }) : null;
  }, [g.id, g.chosenTrack, program, data]);

  const rule = g.id === '__ulw'
    ? program.upperLevelWriting?.rule
    : (program.requirementGroups || []).find((x) => x.id === g.id)?.rule;

  const actionFor = (cid) => describeOptionAction(g, rule, cid, data.courses);
  const onPick = onPickOption
    ? (cid) => onPickOption({ programId: program.id, groupId: g.id, courseId: cid })
    : undefined;

  const declared = program.pathways?.id === g.id ? program.pathways : null;
  const pathwayName = trackChoice || g.chosenTrack;
  const head = (
    <>
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink-2" title={g.note || g.label}>
        {g.label}{pathwayName ? <span className="text-gold"> · {pathwayName}</span> : null}
      </span>
      {!g.complete && onAutoFill && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onAutoFill(program.id, g.id); }}
          title="Auto-fill just this requirement (adds courses; changes nothing else)"
          className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-xs font-semibold text-ink-3 hover:bg-accent-soft hover:text-accent"
        ><Icon name="bolt" size="sm" /> Fill</button>
      )}
    </>
  );

  const isTrackPick = spec?.kind === 'track' && (spec.sets?.length || 0) > 1;
  const pathwayNames = isTrackPick
    ? spec.sets.map((s) => s.name)
    : (declared?.options?.length > 1 ? declared.options : null);
  const noun = pathwayNoun(g, declared?.noun || 'Concentration');
  const picker = pathwayNames ? (
    <PathwaySelect
      noun={noun}
      label={`${noun} for ${g.label}`}
      value={trackChoice}
      names={pathwayNames}
      onChange={(trackName) => onChooseTrack?.({
        programId: program.id, groupId: g.id, trackName,
      })}
    />
  ) : null;

  if (isTrackPick) {
    const activeName = trackChoice || g.chosenTrack;
    return (
      <div>
        <div className="mb-0.5 flex items-baseline gap-2">{head}</div>
        {picker}
        <Meter have={g.have} need={g.need} complete={g.complete} />
        <details className="group/req mt-0.5">
          <summary className="cursor-pointer list-none">
            <div className="flex items-center gap-1">
              <Icon name="chevronRight" size="sm"
                className="shrink-0 text-ink-3 transition-transform group-open/req:rotate-90" />
              <span className="text-xs font-medium text-ink-2">{spec.summary}</span>
            </div>
          </summary>
          <div className="mt-1.5 space-y-2 pl-4">
            {spec.sets.map((s, i) => {
              const setAction = actionFor(s.courses.find((c) => !placedSet?.has(c)) || s.courses[0]);
              const canSwapSet = setAction?.kind === 'swap';
              const active = s.name === activeName;
              return (
                <div key={i}>
                  <div className="label-caps mb-1 flex items-center gap-1.5">
                    <span className={`min-w-0 flex-1 truncate ${active ? 'text-gold' : ''}`}>{s.name}</span>
                    {canSwapSet && onPick && (
                      <button
                        type="button"
                        onClick={() => onPick(s.courses.find((c) => !placedSet?.has(c)) || s.courses[0])}
                        title={`Swap ${setAction.outgoing.join(' + ')} for ${setAction.incoming.join(' + ')}`}
                        className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-xs font-semibold text-accent hover:underline"
                      >
                        <Icon name="swap" size="sm" /> Swap
                      </button>
                    )}
                  </div>
                  <OptionList courses={s.courses} data={data} placedSet={placedSet}
                    actionFor={actionFor} onPick={onPick} />
                </div>
              );
            })}
          </div>
        </details>
      </div>
    );
  }

  // Nothing to choose between: render flat.
  if (!spec || !spec.choice) {
    return (
      <div>
        <div className="mb-0.5 flex items-baseline gap-2">{head}</div>
        {picker}
        <Meter have={g.have} need={g.need} complete={g.complete} />
      </div>
    );
  }

  return (
    <details className="group/req">
      <summary className="cursor-pointer list-none">
        <div className="mb-0.5 flex items-baseline gap-2">
          <Icon name="chevronRight" size="sm"
            className="mt-0.5 shrink-0 text-ink-3 transition-transform group-open/req:rotate-90" />
          {head}
        </div>
        {picker}
        <Meter have={g.have} need={g.need} complete={g.complete} />
        <div className="mt-0.5 pl-4 text-xs font-medium text-ink-2">{spec.summary}</div>
      </summary>

      <div className="mt-1.5 space-y-2 pl-4">
        {/* Named alternatives (sequences, tracks) keep their grouping — the
            student picks a SET, not individual courses. */}
        {spec.sets && spec.sets.map((s, i) => {
          const setAction = actionFor(s.courses.find((c) => !placedSet?.has(c)) || s.courses[0]);
          const canSwapSet = setAction?.kind === 'swap';
          return (
          <div key={i}>
            <div className="label-caps mb-1 flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              {canSwapSet && onPick && (
                <button
                  type="button"
                  onClick={() => onPick(s.courses.find((c) => !placedSet?.has(c)) || s.courses[0])}
                  title={`Swap ${setAction.outgoing.join(' + ')} for ${setAction.incoming.join(' + ')}`}
                  className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-xs font-semibold text-accent hover:underline"
                >
                  <Icon name="swap" size="sm" /> Swap
                </button>
              )}
            </div>
            <OptionList courses={s.courses} data={data} placedSet={placedSet}
              actionFor={actionFor} onPick={onPick} />
          </div>
          );
        })}
        {spec.options && (
          <OptionList courses={spec.options} data={data} placedSet={placedSet}
            actionFor={actionFor} onPick={onPick} />
        )}
        {spec.kind === 'filter' && (
          <p className="text-xs leading-snug text-ink-2">
            {spec.filterText}. Use the <span className="font-semibold">requirement filter</span> in Find
            courses to list them.
          </p>
        )}
        {spec.kind === 'breadth' && (
          <p className="text-xs leading-snug text-ink-2">
            Drawn from the tracks you did not choose in the track requirement above.
          </p>
        )}
      </div>
    </details>
  );
}

// GPA in the courses counted for this program, against its minimum when the
// program sets one. Hidden until at least one counted course has a grade.
function ProgramGpaLine({ program, result, data, plan }) {
  const g = programGpa(plan, data, program, result);
  if (g.gpa == null) return null;
  const min = program.minMajorGPA;
  const below = min && g.gpa < min;
  const noun = program.type === 'minor' ? 'Minor' : 'Major';
  return (
    <p className="tnum mt-0.5 text-xs text-ink-2"
      title={`Letter-graded courses counted toward this program${(program.requirementGroups || []).some((x) => x.ancillary) ? ', excluding allied/ancillary groups' : ''}. Student-entered and unofficial.`}>
      {noun} GPA <span className={`font-semibold ${below ? 'text-bad' : 'text-ink'}`}>{formatGpa(g.gpa)}</span>
      {min ? <span className="text-ink-3"> · minimum {min.toFixed(1)}</span> : null}
      <span className="text-ink-3"> · {g.graded.length} graded</span>
    </p>
  );
}

function ProgramCard({ program, result, data, plan, onAutoFill, placedSet, onPickOption, onChooseTrack, onSwapProgram }) {
  if (!program) return null;
  if (result.needsData) {
    return (
      <div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-ink">{program.name} <span className="text-ink-3 font-normal">({program.degree})</span></span>
          <Tag tone="warn">Requirements not loaded</Tag>
        </div>
        <p className="mt-1 text-xs leading-snug text-ink-2">
          This program is a placeholder — progress can't be checked yet.{' '}
          <a className="text-accent underline" href={program.sourceUrl} target="_blank" rel="noreferrer">
            Official requirements page 
          </a>
        </p>
      </div>
    );
  }
  const family = familyForProgram(program.id);
  const occupied = [...(plan.majorIds || []), ...(plan.minorIds || [])];
  const cardPathway = program.pathways
    && !result.groups.some((g) => g.id === program.pathways.id)
    && (program.pathways.options || []).length > 1
    ? program.pathways
    : null;
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-ink">
          {program.name} <span className="font-normal text-ink-3">({program.degree})</span>
        </span>
        {result.complete
          ? <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-good"><Icon name="check" size="sm" /> Done</span>
          : <span className="tnum text-xs text-ink-3">{result.percent}%</span>}
      </div>
      <ProgramGpaLine program={program} result={result} data={data} plan={plan} />
      {family && (
        <FamilyPicker
          family={family}
          program={program}
          programs={data.programs}
          excludeIds={occupied}
          onSwapProgram={onSwapProgram}
        />
      )}
      {cardPathway && (
        <PathwaySelect
          noun={cardPathway.noun || 'Concentration'}
          label={`${cardPathway.noun || 'Concentration'} for ${program.name}`}
          value={getTrackChoice(plan, program.id, cardPathway.id)}
          names={cardPathway.options}
          onChange={(trackName) => onChooseTrack?.({
            programId: program.id, groupId: cardPathway.id, trackName,
          })}
        />
      )}
      <div className="mt-2 space-y-2">
        {result.groups.map((g) => (
          <RequirementRow
            key={g.id}
            group={g}
            program={program}
            data={data}
            placedSet={placedSet}
            onAutoFill={onAutoFill}
            onPickOption={onPickOption}
            trackChoice={getTrackChoice(plan, program.id, g.id)}
            onChooseTrack={onChooseTrack}
          />
        ))}
      </div>
      {program.notes?.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-ink-3 hover:text-ink-2">Program rules & notes</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-snug text-ink-2">
            {program.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
          <a className="text-xs text-accent underline" href={program.sourceUrl} target="_blank" rel="noreferrer">Source </a>
        </details>
      )}
    </div>
  );
}

function ClusterCard({ cluster, result }) {
  if (!cluster) return null;
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-ink" title={cluster.description}>
          {cluster.name}
        </span>
        {result.complete
          ? <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-good"><Icon name="check" size="sm" /> Done</span>
          : <span className="tnum text-xs text-ink-3">{result.percent}%</span>}
      </div>
      <div className="mt-0.5 text-xs text-ink-3">
        {cluster.homeDept} · {cluster.division.replace('-', ' ')}
      </div>
      {cluster.status === 'PARTIAL_PARSE' && (
        <div className="mt-1"><Tag tone="warn" title={ruleInfo('CLUSTER_PARTIAL_PARSE').text}>Non-standard rule, verify</Tag></div>
      )}
      <div className="mt-2 space-y-1.5">
        {result.groups.map((g) => (
          <div key={g.id}>
            <div className="mb-0.5 truncate text-xs text-ink-2" title={g.label}>
              {g.unit === 'credits' ? `${g.need} credits` : `${g.need} course${g.need > 1 ? 's' : ''}`} from list
            </div>
            <Meter have={g.have} need={g.need} complete={g.complete} />
          </div>
        ))}
      </div>
      {result.usedCourseIds.size > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-3">
          {[...result.usedCourseIds].map((cid) => (
            <Tag key={cid} tone={result.sharedWithPrograms.includes(cid) ? 'gold' : 'neutral'}
              title={result.sharedWithPrograms.includes(cid) ? 'Also counts toward a major/minor (max 1 shared)' : 'Unique to this cluster'}>
              {cid}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
}

export function Checklist({ data, plan, progress, violations, clustersNeeded, onAutoFill, onHide, placedSet, onPickOption, onChooseTrack, onSwapProgram }) {
  const required = resolveRequiredCredits(plan, data);
  const byStatus = creditsByStatus(plan, data);
  const planned = byStatus.completed + byStatus.in_progress + byStatus.planned;
  const overall = cumulativeGpa(plan, data);
  const pwr = progress.pwr;

  const errors = violations.filter((x) => x.severity === 'error');
  const warnings = violations.filter((x) => x.severity === 'warning');
  const infos = violations.filter((x) => x.severity === 'info');

  return (
    <Panel
      title="Degree audit"
      headerRight={onHide && (
        <IconButton icon="close" label="Hide the degree audit panel" onClick={onHide} />
      )}
      bodyClassName="flex flex-col gap-3 !p-3"
    >
      <div className="space-y-6">

        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="tnum text-lg font-bold text-ink">{planned}</span>
            <span className="text-[13px] text-ink-3">/ {required} credit hours</span>
          </div>
          <div className="mt-1"><Meter have={planned} need={required} complete={planned >= required} /></div>
          {(byStatus.completed > 0 || byStatus.in_progress > 0) && (
            <p className="tnum mt-1 text-xs text-ink-2">
              <span className="font-semibold text-good">{byStatus.completed}</span> completed
              <span className="text-ink-3"> · </span>
              <span className="font-semibold text-accent">{byStatus.in_progress}</span> in progress
              <span className="text-ink-3"> · </span>
              <span className="font-semibold text-ink">{byStatus.planned}</span> planned
              {byStatus.noCredit > 0 && (
                <><span className="text-ink-3"> · </span><span className="font-semibold text-warn">{byStatus.noCredit}</span> no credit</>
              )}
            </p>
          )}
          {overall.gpa != null && (
            <p className="tnum mt-0.5 text-xs text-ink-2" title="Letter-graded UR courses only; transfer, AP, P/S and W don't count. Student-entered and unofficial.">
              Cumulative GPA <span className={`font-semibold ${overall.gpa < 2 ? 'text-bad' : 'text-ink'}`}>{formatGpa(overall.gpa)}</span>
              <span className="text-ink-3"> over {overall.credits} graded cr</span>
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            {pwr.satisfied
              ? <Tag tone="good" icon="check" title={`Satisfied via ${pwr.via.join(' + ')}`}>PWR</Tag>
              : pwr.transferOnly
                ? <Tag tone="warn" title={ruleInfo('PWR_TRANSFER').text}>PWR: transfer only</Tag>
                : <Tag tone="warn" title={ruleInfo('PWR_REQUIRED').text}>PWR not planned</Tag>}
            <Tag tone={plan.clusterIds.length >= clustersNeeded ? 'good' : 'warn'}>
              Clusters {plan.clusterIds.length} of {clustersNeeded}
            </Tag>
            {plan.doubleDegree && <Tag tone="accent">Double degree, 136 cr</Tag>}
          </div>
        </div>

        {progress.programs.map((r) => (
          <ProgramCard key={r.programId} program={data.programs.find((p) => p.id === r.programId)} result={r}
            data={data} plan={plan} onAutoFill={onAutoFill} placedSet={placedSet}
            onPickOption={onPickOption} onChooseTrack={onChooseTrack} onSwapProgram={onSwapProgram} />
        ))}
        {progress.clusters.map((r) => (
          <ClusterCard key={r.clusterId} cluster={data.clusters.find((c) => c.id === r.clusterId)} result={r} />
        ))}

        {(plan.majorIds.length + plan.clusterIds.length) === 0 && (
          <p className="text-xs text-ink-3">
            Pick a major to start the audit
          </p>
        )}

        <div>
          <h3 className="label-caps mb-2">
            Rule checks
            {violations.length === 0 && <span className="ml-2 font-normal text-good">all clear</span>}
          </h3>
          <div className="space-y-1">
            {[...errors, ...warnings, ...infos].map((x, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <SevChip severity={x.severity} title={`${ruleInfo(x.ruleId).title}: ${ruleInfo(x.ruleId).text}`}>
                    {ruleInfo(x.ruleId).title}
                  </SevChip>
                  <span className="min-w-0 flex-1 text-xs leading-snug text-ink-2">{x.message}</span>
                </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
