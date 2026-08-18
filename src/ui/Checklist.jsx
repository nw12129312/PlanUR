import React, { useMemo, useState } from 'react';
import { Icon } from './icons.jsx';
import { Meter, SevChip, Tag, IconButton, Panel } from './bits.jsx';
import { describeRequirement } from '../engine/requirementOptions.js';
import { describeOptionAction } from '../engine/swapRequirement.js';
import { ruleInfo } from '../engine/rules.js';
import { resolveRequiredCredits } from '../engine/constraints.js';

// How many options to render before collapsing the tail. ATHS electives has 92
// and LACX 73 — rendering those in full would swamp the rail.
const OPTION_CAP = 14;

// One course option inside an expanded requirement. Shows whether it is already
// in the plan, and offers a one-click add when it is not.
function OptionChip({ cid, data, placedSet, action, onPick }) {
  const c = data.courses[cid];
  const placed = placedSet?.has(cid);
  const swap = action?.kind === 'swap';
  return (
    <li className="flex items-center gap-1.5">
      <span className={`code shrink-0 rounded px-1 py-0.5 ${
        placed ? 'bg-good-soft text-good' : 'bg-surface text-ink-2'}`}>{cid}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3" title={c?.title || cid}>
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
          className="mt-1 text-[11px] font-semibold text-accent hover:underline">
          {showAll ? 'Show fewer' : `Show all ${courses.length} options`}
        </button>
      )}
    </>
  );
}

// A requirement group: meter always visible, options on demand. Only groups
// that actually offer a choice get a disclosure — an all_of has nothing to pick.
function RequirementRow({ group: g, program, data, placedSet, onAutoFill, onPickOption }) {
  const spec = useMemo(() => {
    const src = g.id === '__ulw'
      ? { rule: program.upperLevelWriting?.rule }
      : (program.requirementGroups || []).find((x) => x.id === g.id);
    return src ? describeRequirement(src, data, { chosenTrack: g.chosenTrack }) : null;
  }, [g.id, g.chosenTrack, program, data]);

  const rule = g.id === '__ulw'
    ? program.upperLevelWriting?.rule
    : (program.requirementGroups || []).find((x) => x.id === g.id)?.rule;

  const actionFor = (cid) => describeOptionAction(g, rule, cid);
  const onPick = onPickOption
    ? (cid) => onPickOption({ programId: program.id, groupId: g.id, courseId: cid })
    : undefined;

  const head = (
    <>
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink-2" title={g.note || g.label}>
        {g.label}{g.chosenTrack ? <span className="text-gold"> · {g.chosenTrack}</span> : null}
      </span>
      {!g.complete && onAutoFill && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onAutoFill(program.id, g.id); }}
          title="Auto-fill just this requirement (adds courses; changes nothing else)"
          className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[11px] font-bold text-accent hover:bg-accent-soft"
        ><Icon name="bolt" size="sm" /> fill</button>
      )}
    </>
  );

  // Nothing to choose between: render flat.
  if (!spec || !spec.choice) {
    return (
      <div>
        <div className="mb-0.5 flex items-baseline gap-2">{head}</div>
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
        <Meter have={g.have} need={g.need} complete={g.complete} />
        <div className="mt-0.5 pl-4 text-[11px] font-semibold text-accent">{spec.summary}</div>
      </summary>

      <div className="mt-1.5 space-y-2 rounded-lg bg-surface p-2 pl-2.5">
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
                  className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[10px] font-bold uppercase tracking-wide text-accent hover:bg-accent-soft"
                >
                  <Icon name="swap" size="sm" /> swap
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
          <p className="text-[11px] leading-snug text-ink-2">
            {spec.filterText}. Use the <span className="font-semibold">requirement filter</span> in Find
            courses to list them.
          </p>
        )}
        {spec.kind === 'breadth' && (
          <p className="text-[11px] leading-snug text-ink-2">
            Drawn from the tracks you did not choose in the track requirement above.
          </p>
        )}
      </div>
    </details>
  );
}

function ProgramCard({ program, result, data, onAutoFill, placedSet, onPickOption }) {
  if (!program) return null;
  if (result.needsData) {
    return (
      <div className="rounded-lg bg-surface-2 p-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-ink">{program.name} <span className="text-ink-3 font-normal">({program.degree})</span></span>
          <Tag tone="warn">requirements not loaded</Tag>
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
  return (
    <div className="rounded-lg bg-surface-2 p-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-ink">
          {program.name} <span className="font-normal text-ink-3">({program.degree})</span>
        </span>
        {result.complete
          ? <Tag tone="good">complete</Tag>
          : <span className="tnum text-xs text-ink-2">{result.percent}%</span>}
      </div>
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
          />
        ))}
      </div>
      {program.notes?.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-ink-3 hover:text-ink-2">Program rules & notes</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-ink-2">
            {program.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
          <a className="text-[11px] text-accent underline" href={program.sourceUrl} target="_blank" rel="noreferrer">Source </a>
        </details>
      )}
    </div>
  );
}

function ClusterCard({ cluster, result }) {
  if (!cluster) return null;
  return (
    <div className="rounded-lg bg-surface-2 p-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-ink" title={cluster.description}>
          <Icon name="hexagon" size="sm" className="mr-1 align-[-2px] text-gold" /> {cluster.name}
        </span>
        {result.complete ? <Tag tone="good">complete</Tag> : <span className="tnum text-xs text-ink-2">{result.percent}%</span>}
      </div>
      <div className="mt-0.5 text-[11px] text-ink-3">
        <span className="code">{cluster.id}</span> · {cluster.homeDept} · {cluster.division.replace('-', ' ')}
      </div>
      {cluster.status === 'PARTIAL_PARSE' && (
        <div className="mt-1"><Tag tone="warn" title={ruleInfo('CLUSTER_PARTIAL_PARSE').text}>non-standard rule — verify</Tag></div>
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
        <div className="mt-1.5 flex flex-wrap gap-1">
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

export function Checklist({ data, plan, progress, violations, clustersNeeded, onAutoFill, onAllowSequencing, onRemoveSequencingOverride, onHide, placedSet, onPickOption }) {
  const required = resolveRequiredCredits(plan, data);
  const placedIds = [...new Set([
    ...plan.semesters.flatMap((s) => s.courseIds),
    ...plan.transfer.map((t) => t.courseId),
  ])];
  const planned = placedIds.reduce((a, cid) => a + (data.courses[cid]?.credits ?? 4), 0);
  const pwr = progress.pwr;

  const errors = violations.filter((x) => x.severity === 'error');
  const warnings = violations.filter((x) => x.severity === 'warning');
  const infos = violations.filter((x) => x.severity === 'info');

  return (
    <Panel
      title="Degree audit"
      icon="clipboard"
      headerRight={onHide && (
        <IconButton icon="close" label="Hide the degree audit panel" onClick={onHide} />
      )}
      bodyClassName="flex flex-col gap-2 !p-2"
    >
      <div className="space-y-2">

        <div className="rounded-lg bg-surface-2 p-2">
          <div className="flex items-baseline gap-1.5">
            <span className="tnum text-xl font-semibold text-ink">{planned}</span>
            <span className="text-sm text-ink-2">/ {required} credit hours</span>
          </div>
          <div className="mt-1"><Meter have={planned} need={required} complete={planned >= required} /></div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {pwr.satisfied
              ? <Tag tone="good" icon="check" title={`Satisfied via ${pwr.via.join(' + ')}`}>PWR</Tag>
              : pwr.transferOnly
                ? <Tag tone="warn" title={ruleInfo('PWR_TRANSFER').text}>PWR: transfer only</Tag>
                : <Tag tone="warn" title={ruleInfo('PWR_REQUIRED').text}>PWR not planned</Tag>}
            <Tag tone={plan.clusterIds.length >= clustersNeeded ? 'good' : 'warn'}>
              clusters {plan.clusterIds.length}/{clustersNeeded}
            </Tag>
            {plan.doubleDegree && <Tag tone="accent">double degree · 136 cr</Tag>}
          </div>
        </div>

        {progress.programs.map((r) => (
          <ProgramCard key={r.programId} program={data.programs.find((p) => p.id === r.programId)} result={r}
            data={data} onAutoFill={onAutoFill} placedSet={placedSet} onPickOption={onPickOption} />
        ))}
        {progress.clusters.map((r) => (
          <ClusterCard key={r.clusterId} cluster={data.clusters.find((c) => c.id === r.clusterId)} result={r} />
        ))}

        {(plan.majorIds.length + plan.clusterIds.length) === 0 && (
          <p className="rounded-lg border border-dashed border-line p-2 text-center text-xs text-ink-3">
            Pick a major and clusters above to start the audit.
          </p>
        )}

        <div className="rounded-lg bg-surface-2 p-2">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Rule checks
            {violations.length === 0 && <span className="ml-2 normal-case text-good">all clear</span>}
          </h3>
          <div className="space-y-1">
            {(() => {
              // department-ordering violations come in pairs (one per card);
              // show each pair once here, with its one-click override
              const seenPairs = new Set();
              return [...errors, ...warnings, ...infos].filter((x) => {
                if (x.ruleId !== 'DEPT_SEQUENCING' || !x.pair) return true;
                const k = `${x.pair.lower}|${x.pair.higher}`;
                if (seenPairs.has(k)) return false;
                seenPairs.add(k);
                return true;
              }).map((x, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <SevChip severity={x.severity} title={`${ruleInfo(x.ruleId).title}: ${ruleInfo(x.ruleId).text}`}>
                    {ruleInfo(x.ruleId).title}
                  </SevChip>
                  <span className="min-w-0 flex-1 text-[11px] leading-snug text-ink-2">{x.message}</span>
                  {x.ruleId === 'DEPT_SEQUENCING' && x.pair && onAllowSequencing && (
                    <button
                      type="button"
                      onClick={() => onAllowSequencing(x.pair)}
                      title={`Allow ${x.pair.lower} to be scheduled after ${x.pair.higher} in this plan`}
                      className="shrink-0 rounded-lg bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-accent hover:bg-accent-soft"
                    >Allow</button>
                  )}
                </div>
              ));
            })()}
          </div>
          {(plan.sequencingOverrides || []).length > 0 && (
            <div className="mt-2 border-t border-line pt-1.5">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-3">Sequencing overrides (this plan)</div>
              <div className="flex flex-wrap gap-1">
                {plan.sequencingOverrides.map((o, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2"
                    title={`${o.lower} may be scheduled after ${o.higher}`}>
                    <span className="code">{o.lower}</span> after <span className="code">{o.higher}</span>
                    {onRemoveSequencingOverride && (
                      <button type="button" onClick={() => onRemoveSequencingOverride(o)}
                        aria-label={`Remove override ${o.lower} after ${o.higher}`}
                        className="text-ink-3 hover:text-bad">{<Icon name="close" size="sm" />}</button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
