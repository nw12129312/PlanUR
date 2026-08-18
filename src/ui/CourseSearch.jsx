import React, { useMemo, useState } from 'react';
import { Icon } from './icons.jsx';
import { CourseCard } from './CourseCard.jsx';
import { Select, TextInput, Panel } from './bits.jsx';
import { groupCandidates, namedCandidates } from '../engine/candidates.js';
import { groupsForCourseSet } from '../engine/equivalency.js';
import { getEquivalencyGroups } from '../storage/dataStore.js';

const equivalencyGroupsData = getEquivalencyGroups();

export function CourseSearch({ data, plan, selectedPrograms, selectedClusters, placedSet, onAdd, targetLabel }) {
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [reqKey, setReqKey] = useState('');

  const depts = useMemo(
    () => [...new Set(Object.values(data.courses).map((c) => c.dept))].sort(),
    [data.courses],
  );

  const reqOptions = useMemo(() => {
    const opts = [];
    for (const p of selectedPrograms) {
      if (p.status !== 'ACTIVE') continue;
      for (const g of p.requirementGroups || []) {
        opts.push({ key: `${p.id}::${g.id}`, label: `${p.name} ${p.degree} — ${g.label}` });
      }
      if (p.upperLevelWriting?.rule) {
        opts.push({ key: `${p.id}::__ulw`, label: `${p.name} ${p.degree} — ${p.upperLevelWriting.label}` });
      }
    }
    for (const cl of selectedClusters) {
      opts.push({ key: `cluster::${cl.id}`, label: `Cluster — ${cl.name}` });
    }
    return opts;
  }, [selectedPrograms, selectedClusters]);

  // Every course the selected programs and clusters could actually count.
  // This is what scopes the equivalency block: a "choose one path" decision is
  // only worth surfacing when the student's own requirements depend on it.
  const selectableCourseIds = useMemo(() => {
    const s = new Set();
    for (const p of selectedPrograms) {
      if (p.status !== 'ACTIVE') continue;
      for (const g of p.requirementGroups || []) {
        for (const cid of namedCandidates(g, data)) s.add(cid);
      }
      if (p.upperLevelWriting?.rule) {
        for (const cid of namedCandidates({ rule: p.upperLevelWriting.rule }, data)) s.add(cid);
      }
    }
    for (const cl of selectedClusters) {
      for (const g of cl.groups || []) {
        for (const o of g.options || []) for (const c of o.codes) s.add(c);
      }
    }
    return s;
  }, [selectedPrograms, selectedClusters, data]);

  const relevantEquivGroups = useMemo(
    () => groupsForCourseSet(equivalencyGroupsData, selectableCourseIds),
    [selectableCourseIds],
  );

  const results = useMemo(() => {
    let pool = null; // null = whole catalog
    if (reqKey) {
      const [a, b] = reqKey.split('::');
      if (a === 'cluster') {
        const cl = selectedClusters.find((c) => c.id === b);
        pool = new Set(cl ? cl.groups.flatMap((g) => g.options.flatMap((o) => o.codes)) : []);
      } else {
        const p = selectedPrograms.find((x) => x.id === a);
        const g = b === '__ulw'
          ? { rule: p?.upperLevelWriting?.rule }
          : (p?.requirementGroups || []).find((x) => x.id === b);
        pool = new Set(g ? groupCandidates(g, data) : []);
      }
    }
    const ql = q.trim().toLowerCase();
    const out = [];
    for (const c of Object.values(data.courses)) {
      if (pool && !pool.has(c.id)) continue;
      if (dept && c.dept !== dept) continue;
      if (ql && !c.id.toLowerCase().includes(ql) && !c.title.toLowerCase().includes(ql)) continue;
      out.push(c);
      if (out.length >= 400) break;
    }
    out.sort((x, y) => x.dept.localeCompare(y.dept) || x.number - y.number);
    return out;
  }, [q, dept, reqKey, data, selectedPrograms, selectedClusters]);

  return (
    <Panel
      title="Catalog"
      icon="search"
      className="overflow-hidden"
      bodyClassName="flex flex-col gap-1.5 !p-2"
    >
      <TextInput
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by code or title…"
        aria-label="Search courses"
      />
      {/* Two filters share a row: stacked they cost 56px of rail height that
          the results list needs far more than they do. */}
      <div className="grid grid-cols-2 gap-1.5">
        <Select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department filter"
          className="min-w-0 px-2.5 text-[13px]">
          <option value="">All depts</option>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
        <Select value={reqKey} onChange={(e) => setReqKey(e.target.value)} aria-label="Requirement filter"
          className="min-w-0 px-2.5 text-[13px]">
          <option value="">All reqs</option>
          {reqOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </Select>
      </div>
      <div className="text-[11px] text-ink-3">
        {results.length === 400 ? '400+' : results.length} · to <span className="font-medium text-ink-2">{targetLabel}</span>
      </div>
      <div className="rail max-h-[22rem] min-h-0 space-y-1 overflow-y-auto overscroll-contain pr-1">
        {(() => {
          // Alternatives from the same equivalency group display together,
          // labeled by path. Only groups the SELECTED programs actually depend
          // on are eligible — see selectableCourseIds. Once the student is
          // filtering, the block narrows further to groups still in view; with
          // no filter every relevant group is pinned to the top, so a group is
          // never hidden just because its courses fell outside the 400-row
          // result window.
          const resultIds = new Set(results.map((c) => c.id));
          const filtering = !!(q.trim() || dept || reqKey);
          const sections = relevantEquivGroups.filter((g) => !filtering
            || g.paths.some((p) => p.courses.some((c) => resultIds.has(c))));
          const groupedIds = new Set(sections.flatMap((g) => g.paths.flatMap((p) => p.courses)));
          const rest = results.filter((c) => !groupedIds.has(c.id));
          const card = (c) => (
            <div key={c.id} className={placedSet.has(c.id) ? 'opacity-45' : ''}>
              <CourseCard
                course={c}
                draggable={!placedSet.has(c.id)}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/course', c.id);
                  e.dataTransfer.setData('text/origin', 'search');
                }}
                onAdd={placedSet.has(c.id) ? undefined : () => onAdd(c.id)}
              />
            </div>
          );
          return (
            <>
              {sections.map((g) => (
                // Equivalency groups are a decision point, not a filter result,
                // so they get a full accent-edged block rather than a tinted
                // box. Horizontal padding is kept to a hairline + 8px because
                // every pixel here comes off the course titles inside.
                <section key={g.id}
                  className="overflow-hidden rounded-lg border-2 border-accent bg-accent-soft">
                  <header className="flex items-start gap-1.5 px-2 py-1.5" title={g.description || ''}>
                    <Icon name="swap" size="md" className="mt-px text-accent" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold leading-tight text-ink">{g.name}</div>
                      <div className="text-[11px] font-semibold text-accent">
                        Choose ONE path — mixing them is blocked
                      </div>
                    </div>
                  </header>
                  <div className="space-y-1.5 bg-surface px-1.5 pb-1.5 pt-1.5">
                    {g.paths.map((p) => (
                      <div key={p.id}>
                        <div className="label-caps mb-1 flex items-center gap-1.5">
                          <span className="h-px w-2.5 bg-line" aria-hidden="true" />
                          {p.name}{p.accelerated ? ' · accelerated' : ''}
                        </div>
                        <div className="space-y-1">
                          {p.courses.map((cid) => data.courses[cid]).filter(Boolean).map(card)}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
              {rest.slice(0, 120).map(card)}
              {rest.length > 120 && (
                <div className="py-1 text-center text-xs text-ink-3">Refine the search to see more…</div>
              )}
              {results.length === 0 && <div className="py-4 text-center text-xs text-ink-3">No courses match.</div>}
            </>
          );
        })()}
      </div>
    </Panel>
  );
}
