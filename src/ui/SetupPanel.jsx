import React from 'react';
import { Icon } from './icons.jsx';
import { IconButton, SearchSelect, SectionTitle } from './bits.jsx';

const DIV_LABEL = {
  humanities: 'Humanities',
  'social-sciences': 'Social Sciences',
  'natural-sciences': 'Natural Sciences',
  engineering: 'Engineering',
};

const DIV_ORDER = ['humanities', 'social-sciences', 'natural-sciences', 'engineering'];

function ProgramSelect({ programs, value, onChange, placeholder, exclude = [] }) {
  const options = programs
    .filter((p) => !exclude.includes(p.id) || p.id === value)
    .map((p) => ({
      value: p.id,
      label: `${p.name} (${p.degree})${p.status !== 'ACTIVE' ? ' — requirements not loaded' : ''}`,
      keywords: `${p.name} ${p.degree} ${p.id} ${(p.departments || []).join(' ')}`,
    }));
  return (
    <SearchSelect
      value={value || ''}
      onChange={(v) => onChange(v || null)}
      options={options}
      placeholder={placeholder}
      allowClear={Boolean(value)}
      aria-label={placeholder}
    />
  );
}

export function SetupPanel({ data, plan, clustersNeeded, coverage, onChange }) {
  const majors = data.programs.filter((p) => p.type === 'major');
  const minors = data.programs.filter((p) => p.type === 'minor');

  const setList = (key, idx, val) => {
    const list = [...plan[key]];
    if (val) list[idx] = val; else list.splice(idx, 1);
    onChange({ ...plan, [key]: list.filter(Boolean) });
  };

  const clusterOptions = [...data.clusters]
    .sort((a, b) => (DIV_ORDER.indexOf(a.division) - DIV_ORDER.indexOf(b.division))
      || a.name.localeCompare(b.name))
    .filter((cl) => !plan.clusterIds.includes(cl.id))
    .map((cl) => ({
      value: cl.id,
      label: `${cl.name} — ${cl.homeDept} (${cl.id})`,
      keywords: `${cl.name} ${cl.homeDept} ${cl.id} ${cl.description || ''} ${DIV_LABEL[cl.division] || ''}`,
      group: DIV_LABEL[cl.division] || cl.division,
    }));

  return (
    <div className="grid gap-x-4 gap-y-3 md:grid-cols-3">
      <div className="space-y-1.5">
        <SectionTitle>Major{plan.majorIds.length > 1 ? 's' : ''}</SectionTitle>
        <ProgramSelect programs={majors} value={plan.majorIds[0]} exclude={plan.majorIds}
          onChange={(v) => setList('majorIds', 0, v)} placeholder="Choose a major…" />
        <ProgramSelect programs={majors} value={plan.majorIds[1]} exclude={plan.majorIds}
          onChange={(v) => setList('majorIds', 1, v)} placeholder="Add a second major (optional)" />
        {plan.majorIds.length === 2 && (
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={plan.doubleDegree}
              onChange={(e) => onChange({ ...plan, doubleDegree: e.target.checked })}
            />
            Double degree (two BS, or BA + BS) — 136 credit hours
          </label>
        )}
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Minor (optional)</SectionTitle>
        <ProgramSelect programs={minors} value={plan.minorIds[0]} exclude={plan.minorIds}
          onChange={(v) => setList('minorIds', 0, v)} placeholder="Choose a minor…" />
        <ProgramSelect programs={minors} value={plan.minorIds[1]} exclude={plan.minorIds}
          onChange={(v) => setList('minorIds', 1, v)} placeholder="Add a second minor (optional)" />
      </div>

      <div className="space-y-1.5">
        <SectionTitle
          right={(
            <span
              className={`tnum text-xs font-semibold ${clustersNeeded > plan.clusterIds.length ? 'text-warn' : 'text-good'}`}
              title="A minor or a second major can stand in for a cluster"
            >
              {plan.clusterIds.length}/{clustersNeeded}
            </span>
          )}
        >
          Clusters
        </SectionTitle>
        {plan.clusterIds.map((cid, i) => {
          const cl = data.clusters.find((c) => c.id === cid);
          return (
            <div key={cid} className="flex min-h-9 items-center gap-1.5 rounded-md bg-ground pl-2.5 pr-0.5 text-[13px]">
              <span className="min-w-0 flex-1 truncate font-medium text-ink"
                title={cl ? `${cid} · ${DIV_LABEL[cl.division]} — ${cl.description}` : cid}>
                {cl?.name || cid}
              </span>
              {cl && <span className="shrink-0 text-xs text-ink-3">{DIV_LABEL[cl.division]}</span>}
              <IconButton icon="close" label={`Remove cluster ${cid}`} tone="danger" size="sm"
                onClick={() => setList('clusterIds', i, null)} />
            </div>
          );
        })}
        {plan.clusterIds.length < 2 && (
          <SearchSelect
            value=""
            aria-label="Add a cluster"
            placeholder="Add a cluster…"
            options={clusterOptions}
            onChange={(v) => { if (v) setList('clusterIds', plan.clusterIds.length, v); }}
          />
        )}
      </div>

      {coverage?.applicable && !coverage.satisfied && (
        <div className="md:col-span-3 flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2" role="status">
          <Icon name="warning" size="md" className="mt-0.5 text-warn" />
          <p className="text-xs leading-snug text-warn">{coverage.message}</p>
        </div>
      )}
    </div>
  );
}
