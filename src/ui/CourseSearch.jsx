import React, { useMemo, useState } from 'react';
import { CourseCard } from './CourseCard.jsx';
import { Select, TextInput, Panel } from './bits.jsx';
import { groupCandidates, namedCandidates } from '../engine/candidates.js';
import { groupsForCourseSet } from '../engine/equivalency.js';
import { coversCourse } from '../engine/crossList.js';
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
      className="overflow-hidden"
      headerRight={(
        <span className="min-w-0 truncate pr-1 text-xs text-ink-3" title="Where the + button adds a course">
          Adds to <span className="font-semibold text-ink-2">{targetLabel}</span>
        </span>
      )}
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
          const isPlaced = (c) => coversCourse(placedSet, c.id, data.courses);
          const card = (c) => (
            <div key={c.id} className={isPlaced(c) ? 'opacity-45' : ''}>
              <CourseCard
                course={c}
                draggable={!isPlaced(c)}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/course', c.id);
                  e.dataTransfer.setData('text/origin', 'search');
                }}
                onAdd={isPlaced(c) ? undefined : () => onAdd(c.id)}
              />
            </div>
          );
          return (
            <>
              {sections.map((g) => (
                // Equivalency groups are a decision point, not a filter result,
                // so they sit on the pale ground like a semester does.
                <section key={g.id}
                  className="rounded-lg bg-ground p-1.5">
                  <header className="flex items-baseline justify-between gap-2 px-0.5 pb-1" title={g.description || ''}>
                    <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{g.name}</span>
                    <span className="shrink-0 text-xs text-ink-3">pick one path</span>
                  </header>
                  <div className="space-y-1.5">
                    {g.paths.map((p) => (
                      <div key={p.id}>
                        <div className="mb-0.5 px-0.5 text-xs font-medium text-ink-3">
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
