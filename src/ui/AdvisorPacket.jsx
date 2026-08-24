import React from 'react';
import { ruleInfo } from '../engine/rules.js';
import { KIND_LABEL, emptyExamTable, transferCreditGroups } from '../engine/examCredit.js';

const YEAR_NAMES = ['First year', 'Sophomore year', 'Junior year', 'Senior year', 'Fifth year', 'Sixth year'];

function groupIntoYears(semesters) {
  const years = [];
  for (const sem of semesters) {
    const last = years[years.length - 1];
    if (last && last.length < 2) last.push(sem);
    else years.push([sem]);
  }
  return years;
}

function creditsFor(data, ids) {
  return ids.reduce((a, cid) => a + (data.courses[cid]?.credits ?? 4), 0);
}

function slugFilename(name) {
  return (name || 'schedule')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

/** Opens the print dialog. Choose “Save as PDF” to attach the packet to email. */
export function exportAdvisorPdf(planName) {
  const prev = document.title;
  document.title = `${slugFilename(planName)} — UR schedule for advisor`;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    document.title = prev;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
  setTimeout(restore, 1500);
}

export function AdvisorPacket({
  data, plan, progress, violations, clustersNeeded, requiredCredits, plannedCredits,
}) {
  const generated = new Date().toLocaleString(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  });
  const programs = [...plan.majorIds, ...plan.minorIds]
    .map((id) => data.programs.find((p) => p.id === id)).filter(Boolean);
  const clusters = plan.clusterIds
    .map((id) => data.clusters.find((c) => c.id === id)).filter(Boolean);
  const years = groupIntoYears(plan.semesters);
  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');
  const pwr = progress.pwr;

  return (
    <article className="advisor-packet" aria-hidden="true">
      <header className="ap-letterhead">
        <p className="ap-kicker">University of Rochester · Unofficial planning packet</p>
        <h1>Schedule for advisor review</h1>
        <p className="ap-plan-name">{plan.name || 'Untitled plan'}</p>
        <p className="ap-meta">Generated {generated} · {plannedCredits} of {requiredCredits} credit hours planned</p>
      </header>

      <section className="ap-fields">
        <p><span>Student name</span></p>
        <p><span>UR ID / NetID</span></p>
        <p><span>Advisor</span></p>
        <p><span>Expected graduation</span></p>
      </section>

      <section>
        <h2>Programs &amp; clusters</h2>
        {programs.length === 0 && clusters.length === 0 && (
          <p>No major, minor, or cluster selected yet.</p>
        )}
        <ul className="ap-plain">
          {programs.map((p) => (
            <li key={p.id}>
              <strong>{p.type === 'minor' ? 'Minor' : 'Major'}:</strong>{' '}
              {p.name} ({p.degree})
              {p.status !== 'ACTIVE' ? ' — requirements not loaded in this tool' : ''}
              {plan.doubleDegree && p.type === 'major' ? ' · double degree' : ''}
            </li>
          ))}
          {clusters.map((c) => (
            <li key={c.id}>
              <strong>Cluster:</strong> {c.name} ({c.id} · {c.homeDept} · {c.division.replace(/-/g, ' ')})
            </li>
          ))}
          <li>
            <strong>Clusters:</strong> {plan.clusterIds.length} of {clustersNeeded} required
            {plan.doubleDegree ? ' · 136 credit hours (double degree)' : ''}
          </li>
          <li>
            <strong>Primary Writing Requirement:</strong>{' '}
            {pwr.satisfied
              ? `satisfied via ${pwr.via.join(' + ')}`
              : pwr.transferOnly
                ? `transfer/AP only (${(pwr.via || []).join(' + ') || 'see notes'}) — confirm with adviser`
                : 'not yet planned'}
          </li>
        </ul>
      </section>

      <section>
        <h2>Semester schedule</h2>
        {years.map((yearSems, yi) => {
          const yearCredits = yearSems.reduce((a, s) => a + creditsFor(data, s.courseIds), 0);
          return (
            <div key={yi} className="ap-year">
              <h3>
                {YEAR_NAMES[yi] || `Year ${yi + 1}`}
                <span>{yearCredits} cr</span>
              </h3>
              <div className="ap-sem-grid">
                {yearSems.map((sem) => {
                  const cr = creditsFor(data, sem.courseIds);
                  return (
                    <div key={sem.id} className="ap-sem">
                      <h4>
                        {sem.label}
                        <span>{cr} cr{sem.courseIds.length ? ` · ${sem.courseIds.length} courses` : ''}</span>
                      </h4>
                      {sem.courseIds.length === 0 ? (
                        <p className="ap-empty">No courses placed</p>
                      ) : (
                        <table>
                          <thead>
                            <tr>
                              <th>Code</th>
                              <th>Title</th>
                              <th>Cr</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sem.courseIds.map((cid) => {
                              const c = data.courses[cid];
                              return (
                                <tr key={cid}>
                                  <td className="ap-code">{cid}</td>
                                  <td>{c?.title || 'Not in the 2025–26 catalog'}</td>
                                  <td className="ap-cr">{c?.credits ?? 4}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      <section>
        <h2>AP · IB · Transfer credit</h2>
        {plan.transfer.length === 0 && !(plan.transferExams || []).length ? (
          <p>None recorded.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Exam / source</th>
                <th>Code</th>
                <th>Title</th>
                <th>Type</th>
                <th>Cr</th>
              </tr>
            </thead>
            <tbody>
              {transferCreditGroups(plan, data.examCredit || emptyExamTable()).map((g) => {
                if (g.courses.length === 0) {
                  return (
                    <tr key={g.key}>
                      <td>{g.title}</td>
                      <td className="ap-code">—</td>
                      <td>{g.note || 'No named UR course'}</td>
                      <td>{KIND_LABEL[g.kind] || g.kind}</td>
                      <td className="ap-cr">—</td>
                    </tr>
                  );
                }
                return g.courses.map((t, i) => {
                  const c = data.courses[t.courseId];
                  return (
                    <tr key={`${g.key}-${t.courseId}`}>
                      <td>{i === 0 ? g.title : ''}</td>
                      <td className="ap-code">{t.courseId}</td>
                      <td>{c?.title || t.courseId}{t.conditional ? ' (conditional)' : ''}</td>
                      <td>{KIND_LABEL[t.kind] || t.kind}</td>
                      <td className="ap-cr">{c?.credits ?? 4}</td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        )}
        <p className="ap-note">Transfer and AP/IB credit counts for prerequisites and hours in this tool; it never counts toward clusters.</p>
      </section>

      <section>
        <h2>Requirement progress</h2>
        {progress.programs.map((r) => {
          const program = data.programs.find((p) => p.id === r.programId);
          if (!program) return null;
          return (
            <div key={r.programId} className="ap-prog">
              <h3>
                {program.name} ({program.degree})
                <span>
                  {r.needsData ? 'requirements not loaded' : r.complete ? 'complete' : `${r.percent}%`}
                </span>
              </h3>
              {!r.needsData && (
                <table>
                  <thead>
                    <tr>
                      <th>Requirement</th>
                      <th>Progress</th>
                      <th>Courses counting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.groups.map((g) => (
                      <tr key={g.id}>
                        <td>{g.label}{g.chosenTrack ? ` · ${g.chosenTrack}` : ''}</td>
                        <td className="ap-cr">{g.have}/{g.need}{g.complete ? ' ✓' : ''}</td>
                        <td>{(g.satisfiedBy || []).join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
        {progress.clusters.map((r) => {
          const cluster = data.clusters.find((c) => c.id === r.clusterId);
          if (!cluster) return null;
          return (
            <div key={r.clusterId} className="ap-prog">
              <h3>
                Cluster: {cluster.name}
                <span>{r.complete ? 'complete' : `${r.percent}%`}</span>
              </h3>
              <p className="ap-note">
                {(r.usedCourseIds && [...r.usedCourseIds].join(', ')) || 'No courses assigned yet'}
              </p>
            </div>
          );
        })}
      </section>

      <section>
        <h2>Rule checks for discussion</h2>
        {errors.length === 0 && warnings.length === 0 ? (
          <p>No rule errors or warnings in this plan.</p>
        ) : (
          <ul className="ap-plain">
            {[...errors, ...warnings].map((v, i) => (
              <li key={i}>
                <strong>{v.severity === 'error' ? 'Error' : 'Warning'} — {ruleInfo(v.ruleId).title}:</strong>{' '}
                {v.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ap-notes">
        <h2>Advisor notes</h2>
        <div className="ap-lines" />
      </section>

      <footer className="ap-disclaimer">
        This packet was generated by UR Schedule Builder, an unofficial student planning tool.
        It is not a degree audit. Confirm requirements, offering terms, and substitutions with
        the student’s academic adviser before registration. Catalog data was sourced from
        University of Rochester pages and may be incomplete or out of date.
      </footer>
    </article>
  );
}
