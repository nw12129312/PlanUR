// Server-render smoke tests: catches render-time crashes across the whole UI
// tree using the real data files (effects don't run; logic is covered by
// engine tests).
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';
import examCreditData from '../src/data/exam_credit.json';
import { newPlan } from '../src/engine/model.js';
import { checkAll } from '../src/engine/constraints.js';

import App from '../src/App.jsx';
import { SetupPanel } from '../src/ui/SetupPanel.jsx';
import { Checklist } from '../src/ui/Checklist.jsx';
import { SemesterGrid } from '../src/ui/SemesterGrid.jsx';
import { CourseSearch } from '../src/ui/CourseSearch.jsx';
import { GenerateBar, DiffModal, CoverageModal } from '../src/ui/AutoGen.jsx';
import { AdvisorPacket } from '../src/ui/AdvisorPacket.jsx';
import { autoGenerate } from '../src/engine/autogen.js';
import { divisionalCoverageForPlan } from '../src/engine/coverage.js';

const DATA = { courses: coursesData, programs: programsData, clusters: clustersData, policy: policyData, equivalencyGroups: equivalencyGroupsData, examCredit: examCreditData };

function loadedPlan() {
  const plan = newPlan('smoke', 2026);
  plan.majorIds = ['major-csc-bs', 'biol-ba'];
  plan.minorIds = ['minor-csc'];
  plan.clusterIds = ['H1ENG015', 'S1ASL001'];
  plan.doubleDegree = true;
  plan.semesters[0].courseIds = ['CSC 171', 'MATH 150', 'WRTG 105', 'ENGL 121'];
  plan.semesters[1].courseIds = ['CSC 172', 'MATH 161', 'BIOL 110L']; // BIOL 110L in spring -> warning path
  plan.semesters[2].courseIds = ['CSC 173', 'CSC 242', 'CSC 282', 'CSC 252', 'CSC 254']; // overload path
  plan.transfer = [{ courseId: 'MATH 141', kind: 'ap' }];
  return plan;
}

describe('UI render smoke', () => {
  it('renders the full App tree (empty initial plan)', () => {
    const html = renderToString(<App />);
    expect(html).toContain('Planur');
    expect(html).toContain('wordmark-u');
    expect(html).toContain('wordmark-r');
    expect(html).toContain('UR Schedule Builder');
    expect(html).toContain('Save plan');
    expect(html).toContain('Export PDF');
    expect(html).toContain('Schedule for advisor review');
  });

  it('renders all panels with a heavily loaded plan (violations, badges, meters)', () => {
    const plan = loadedPlan();
    const { progress, violations } = checkAll(plan, DATA);
    expect(violations.length).toBeGreaterThan(0);

    const selectedPrograms = [...plan.majorIds, ...plan.minorIds]
      .map((id) => DATA.programs.find((p) => p.id === id));
    const selectedClusters = plan.clusterIds.map((id) => DATA.clusters.find((c) => c.id === id));
    const byCourse = new Map();
    for (const x of violations) if (x.courseId) (byCourse.get(x.courseId) || byCourse.set(x.courseId, []).get(x.courseId)).push(x);
    const bySem = new Map();
    for (const x of violations) if (x.semesterId && !x.courseId) (bySem.get(x.semesterId) || bySem.set(x.semesterId, []).get(x.semesterId)).push(x);

    const setup = renderToString(<SetupPanel data={DATA} plan={plan} clustersNeeded={0} onChange={() => {}} />);
    expect(setup).toContain('Computer Science');
    expect(setup).toContain('Biology');
    expect(setup).toContain('Add a second minor');

    const checklist = renderToString(
      <Checklist data={DATA} plan={plan} progress={progress} violations={violations} clustersNeeded={0} />,
    );
    expect(checklist).toContain('Computer Science');
    expect(checklist).toContain('credit hours');
    expect(checklist).toContain('Biology (BA)');
    expect(checklist).toContain('Track');

    const grid = renderToString(
      <SemesterGrid
        data={DATA} plan={plan} activeSemesterId={null}
        onSetActive={() => {}} onDropOnCourse={() => {}} onMoveToSemester={() => {}} onRemoveCourse={() => {}}
        onAddSemester={() => {}} onAddSummer={() => {}} onRemoveSemester={() => {}}
        violationsByCourse={byCourse} violationsBySemester={bySem}
        courseUses={progress.courseUses} onAddTransfer={() => {}} onRemoveTransfer={() => {}}
      />,
    );
    expect(grid).toContain('Add semester');
    expect(grid).toContain('Add a summer semester');
    expect(grid).toContain('Summer 2027');
    expect(grid).toContain('CSC 171');
    expect(grid).toContain('Drop here to move without swapping');
    expect(grid).toContain('Transfer');
    expect(grid).toContain('From exam');
    expect(grid).toContain('MATH 141');

    const search = renderToString(
      <CourseSearch
        data={DATA} plan={plan}
        selectedPrograms={selectedPrograms} selectedClusters={selectedClusters}
        placedSet={new Set(['CSC 171'])} onAdd={() => {}} targetLabel="Fall 2026"
      />,
    );
    expect(search).toContain('Catalog');

    const packet = renderToString(
      <AdvisorPacket
        data={DATA} plan={plan} progress={progress} violations={violations}
        clustersNeeded={2} requiredCredits={128} plannedCredits={40}
      />,
    );
    expect(packet).toContain('CSC 171');
    expect(packet).toContain('advisor review');
    expect(packet).toContain('Computer Science');
  });

  it('renders the generate bar and diff modal with a real generation result', () => {
    const plan = newPlan('gen-smoke', 2026);
    plan.majorIds = ['major-csc-bs'];
    plan.clusterIds = ['H1ENG015', 'S1ASL001'];

    const bar = renderToString(
      <GenerateBar plan={plan} data={DATA} onGenerate={() => {}} onLockAll={() => {}} busy={false} />,
    );
    expect(bar).toContain('Auto-generate');
    expect(bar).toContain('Schedule style');
    expect(bar).toContain('Mixed subjects');

    const result = autoGenerate(plan, DATA);
    const modal = renderToString(
      <DiffModal base={plan} result={result} data={DATA} onApply={() => {}} onClose={() => {}} />,
    );
    expect(modal).toContain('Review generated changes');
    expect(modal).toContain('WRTG 105');
  });

  it('renders the divisional-coverage banner and modal for an incomplete combination', () => {
    const plan = newPlan('cov-smoke', 2026);
    plan.majorIds = ['major-csc-bs'];
    plan.minorIds = ['minor-csc']; // both natural sciences: hum + socsci missing
    const coverage = divisionalCoverageForPlan(plan, DATA);
    expect(coverage.applicable).toBe(true);
    expect(coverage.satisfied).toBe(false);

    const setup = renderToString(
      <SetupPanel data={DATA} plan={plan} clustersNeeded={2} coverage={coverage} onChange={() => {}} />,
    );
    expect(setup).toContain('generally expects');

    const modal = renderToString(
      <CoverageModal coverage={coverage} onAdjust={() => {}} onProceed={() => {}} />,
    );
    expect(modal).toContain('Go back and adjust selections');
    expect(modal).toContain('Proceed anyway');

    // satisfied combinations render no banner
    plan.clusterIds = []; plan.minorIds = [];
    const ok = divisionalCoverageForPlan(plan, DATA); // single program: not applicable
    const setup2 = renderToString(
      <SetupPanel data={DATA} plan={plan} clustersNeeded={2} coverage={ok} onChange={() => {}} />,
    );
    expect(setup2).not.toContain('generally expects');
  });

  it('renders a Political Science concentration picker in the audit', () => {
    const plan = newPlan('psc', 2026);
    plan.majorIds = ['major-psc-ba'];
    const { progress, violations } = checkAll(plan, DATA);
    const html = renderToString(
      <Checklist data={DATA} plan={plan} progress={progress} violations={violations} clustersNeeded={2} />,
    );
    expect(html).toContain('Choose a track');
    expect(html).toContain('Data and Modeling');
    expect(html).toContain('Elections and Government');
  });
});
