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
    const html = renderToString(<CourseCard placed course={course()} />);
    expect(html).not.toContain('instructors');
    expect(html).not.toContain('Ted Pawlicki');
  });

  it('links a single instructor to their RateMyProfessors page with the rating', () => {
    const html = renderToString(<CourseCard placed course={course({ instructors: ['Ted Pawlicki'] })} />);
    expect(html).toMatch(/chip-text">Ted Pawlicki</);
    expect(html).toContain('href="https://www.ratemyprofessors.com/professor/22421"');
    expect(html).toContain('target="_blank"');
    expect(html).toMatch(/RateMyProfessors 2\.1\/5/);
    expect(html).not.toContain('more instructors');
  });

  it('links every instructor by name when a course has several', () => {
    const html = renderToString(
      <CourseCard placed course={course({ instructors: ['Ted Pawlicki', 'Monika Polak'] })} />,
    );
    expect(html).toMatch(/chip-text">Ted Pawlicki</);
    expect(html).toMatch(/chip-text">Monika Polak</);
    expect(html.match(/ratemyprofessors\.com\/professor\//g)).toHaveLength(2);
    expect(html).not.toContain('instructors</span>');
  });

  it('falls back to a RateMyProfessors search for an unmatched name', () => {
    const html = renderToString(
      <CourseCard placed course={course({ instructors: ['Zzyzx Notaprofessor'] })} />,
    );
    expect(html).toContain('href="https://www.ratemyprofessors.com/search/professors/1331?q=Zzyzx%20Notaprofessor"');
  });

  it('keeps two most-rated names inline and the rest behind "+N more"', () => {
    const names = ['Gongping Niu', 'Hari Rau-Murthy', 'Mark Herman', 'Mary Cook', 'Saul Lubkin'];
    const html = renderToString(<CourseCard placed course={course({ instructors: names })} />);
    expect(html).toMatch(/chip-text">Mark Herman</);
    expect(html).toContain('+3 more');
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it('puts program tags in the top row and colors majors, minors and clusters apart', () => {
    const uses = [
      { kind: 'major', id: 'm', label: 'Computer Science BS: Core' },
      { kind: 'minor', id: 'n', label: 'Mathematics Minor: Calculus' },
      { kind: 'cluster', id: 'c', label: 'Cluster: Psychology' },
    ];
    const html = renderToString(
      <CourseCard placed uses={uses.slice(0, 2)} course={course({ instructors: ['Ted Pawlicki'] })} />,
    );
    expect(html).toContain('text-major');
    expect(html).toContain('text-minor');
    expect(html.indexOf('chip-text">Computer Science BS: Core')).toBeGreaterThan(-1);
    expect(html.indexOf('chip-text">Computer Science BS: Core')).toBeLessThan(html.indexOf('chip-text">Ted Pawlicki'));
    const cl = renderToString(<CourseCard placed uses={[uses[2]]} course={course()} />);
    expect(cl).toContain('text-gold');
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
