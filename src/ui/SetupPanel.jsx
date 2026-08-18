import React from 'react';
import { Icon } from './icons.jsx';
import { SearchSelect, SectionTitle, Tag } from './bits.jsx';

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
    <div className="grid gap-3 md:grid-cols-3">
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
        <p className="text-[11px] leading-snug text-ink-3">
          A minor or a second major may substitute for one or both clusters.
        </p>
      </div>

      <div className="space-y-1.5">
        <SectionTitle
          right={<Tag tone={clustersNeeded > plan.clusterIds.length ? 'warn' : 'good'}>
            {plan.clusterIds.length}/{clustersNeeded} selected
          </Tag>}
        >
          Clusters
        </SectionTitle>
        {plan.clusterIds.map((cid, i) => {
          const cl = data.clusters.find((c) => c.id === cid);
          return (
            <div key={cid} className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1 text-sm">
              <span className="min-w-0 flex-1 truncate" title={cl ? `${cl.name} — ${cl.description}` : cid}>
                <span className="code mr-1">{cid}</span>{cl?.name}
              </span>
              {cl && <Tag>{DIV_LABEL[cl.division]}</Tag>}
              <button type="button" onClick={() => setList('clusterIds', i, null)} aria-label={`Remove cluster ${cid}`}
                className="text-ink-3 hover:text-bad">{<Icon name="close" size="sm" />}</button>
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
        <p className="text-[11px] leading-snug text-ink-3">
          198 clusters loaded from the official 2025–26 Cluster Search Engine listing.
        </p>
      </div>

      {coverage?.applicable && !coverage.satisfied && (
        <div className="md:col-span-3 flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5" role="status">
          <Icon name="warning" size="md" className="mt-0.5 text-warn" />
          <p className="text-xs leading-snug text-warn">{coverage.message}</p>
        </div>
      )}
    </div>
  );
}
