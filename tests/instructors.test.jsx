import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

import coursesData from '../src/data/courses.json';
import { CourseCard, namedInstructors } from '../src/ui/CourseCard.jsx';

function course(overrides = {}) {
  return {
    id: 'CSC 171', dept: 'CSC', number: 171, suffix: '',
    title: 'Introduction to Computer Science', credits: 4, creditsVerified: true,
    offered: ['fall'], offeredClaim: [], offeredVerified: true,
    prereqs: [], prereqsVerified: true, prereqNote: null, prereqSource: null,
    instructors: [],
    description: '', source: 'test', stub: false,
    ...overrides,
  };
}

describe('namedInstructors', () => {
  it('drops blanks and treats a missing field as none', () => {
    expect(namedInstructors({})).toEqual([]);
    expect(namedInstructors({ instructors: ['Ted Pawlicki', '  ', ''] })).toEqual(['Ted Pawlicki']);
  });
});

describe('CourseCard instructor chip', () => {
  it('omits the instructor chip when CDCS listed no names', () => {
    const html = renderToString(<CourseCard course={course()} />);
    expect(html).not.toContain('Multiple Instructors');
    expect(html).not.toContain('Ted Pawlicki');
  });

  it('shows the CDCS name next to a head icon for a single instructor', () => {
    const html = renderToString(<CourseCard course={course({ instructors: ['Ted Pawlicki'] })} />);
    expect(html).toContain('Ted Pawlicki');
    expect(html).not.toContain('Multiple Instructors');
  });

  it('collapses several instructors behind a clickable Multiple Instructors control', () => {
    const html = renderToString(
      <CourseCard course={course({ instructors: ['Ted Pawlicki', 'Monika Polak'] })} />,
    );
    expect(html).toContain('Multiple Instructors');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toMatch(/chip-text">Multiple Instructors</);
    expect(html).not.toMatch(/chip-text">Ted Pawlicki</);
  });
});

describe('CDCS instructor catalog', () => {
  it('attaches real instructor names to scheduled courses, never Staff/TBA', () => {
    const live = Object.values(coursesData).filter((c) => !c.stub);
    const named = live.filter((c) => Array.isArray(c.instructors) && c.instructors.length > 0);
    expect(named.length).toBeGreaterThan(500);
    for (const c of named) {
      expect(c.instructors.every((n) => typeof n === 'string' && n.trim().length > 1)).toBe(true);
      expect(c.instructors.map((n) => n.toLowerCase())).not.toContain('staff');
      expect(c.instructors.map((n) => n.toLowerCase())).not.toContain('tba');
    }
  });

  it('records at least one named instructor on core CSC intro courses', () => {
    for (const id of ['CSC 171', 'CSC 172', 'CSC 173']) {
      expect(namedInstructors(coursesData[id]).length).toBeGreaterThan(0);
    }
  });
});
