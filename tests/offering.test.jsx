import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import { newPlan } from '../src/engine/model.js';
import { checkOfferingSemester } from '../src/engine/constraints.js';
import { notRecentlyOfferedMessage, termLabel } from '../src/engine/offering.js';
import { CourseCard } from '../src/ui/CourseCard.jsx';

const DATA = {
  courses: coursesData, programs: programsData, clusters: clustersData,
  policy: policyData, equivalencyGroups: equivalencyGroupsData,
};

const OLD = {
  id: 'MATH 163', dept: 'MATH', number: 163, suffix: '', title: 'MATH 163',
  credits: 4, creditsVerified: false, offered: [], offeredClaim: [], offeredVerified: false,
  lastOffered: null, notRecentlyOffered: true,
  prereqs: [], prereqsVerified: false, prereqNote: null, prereqSource: null,
  instructors: [], description: '', crossListings: [], source: 'test', stub: true,
};

describe('offering recency', () => {
  it('labels CDCS term keys', () => {
    expect(termLabel('2025-fall')).toBe('Fall 2025');
    expect(termLabel('2027-spring')).toBe('Spring 2027');
    expect(termLabel(null)).toBe('');
  });

  it('explains a flagged course, with the window and last term when known', () => {
    expect(notRecentlyOfferedMessage({ ...OLD, notRecentlyOffered: false })).toBeNull();
    expect(notRecentlyOfferedMessage(OLD, 'Fall 2023 to Spring 2027'))
      .toMatch(/MATH 163 has no sections in any UR course schedule \(Fall 2023 to Spring 2027\)/);
    expect(notRecentlyOfferedMessage({ ...OLD, lastOffered: '2022-spring' }))
      .toMatch(/last ran in Spring 2022/);
  });

  it('warns when a plan uses a course that is not offered recently', () => {
    const data = { ...DATA, courses: { ...coursesData, [OLD.id]: OLD } };
    const plan = newPlan('offering', 2026);
    plan.semesters[0].courseIds = [OLD.id];
    const vs = checkOfferingSemester(plan, data);
    expect(vs.map((v) => v.ruleId)).toEqual(['OFFERING_INACTIVE']);
    expect(vs[0].severity).toBe('warning');
  });

  it('every flagged course in the built data has no recent offering terms', () => {
    for (const c of Object.values(coursesData)) {
      if (typeof c.notRecentlyOffered !== 'boolean') throw new Error(`${c.id} missing notRecentlyOffered`);
    }
  });

  it('shows a "Not offered recently" tag on catalog and placed cards', () => {
    const search = renderToString(<CourseCard course={OLD} onAdd={() => {}} />);
    expect(search).toContain('Not offered recently');
    const placed = renderToString(<CourseCard course={OLD} placed violations={[]} />);
    expect(placed).toContain('Not offered recently');
    const current = renderToString(<CourseCard course={{ ...OLD, notRecentlyOffered: false }} onAdd={() => {}} />);
    expect(current).not.toContain('Not offered recently');
  });
});
