import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { coursiclePageUrl } from '../src/engine/coursicle.js';
import { CourseCard } from '../src/ui/CourseCard.jsx';

function course(overrides = {}) {
  return {
    id: 'CSC 171', dept: 'CSC', number: 171, suffix: '',
    title: 'Introduction to Computer Science', credits: 4, creditsVerified: true,
    offered: ['fall'], offeredClaim: [], offeredVerified: true,
    prereqs: [], prereqsVerified: true, prereqNote: null, prereqSource: null,
    instructors: [], description: '', source: 'test', stub: false,
    ...overrides,
  };
}

describe('coursiclePageUrl', () => {
  it('builds the Coursicle course page from the course code', () => {
    expect(coursiclePageUrl('CSC 171')).toBe('https://www.coursicle.com/rochester/courses/CSC/171/');
    expect(coursiclePageUrl('chem 171')).toBe('https://www.coursicle.com/rochester/courses/CHEM/171/');
  });

  it('files suffixed numbers under the base number', () => {
    expect(coursiclePageUrl('MATH 235W')).toBe('https://www.coursicle.com/rochester/courses/MATH/235/');
    expect(coursiclePageUrl('BIOL 250PW')).toBe('https://www.coursicle.com/rochester/courses/BIOL/250/');
  });

  it('returns null for placeholders and malformed codes', () => {
    expect(coursiclePageUrl('BIOL 000')).toBeNull();
    expect(coursiclePageUrl('')).toBeNull();
    expect(coursiclePageUrl(null)).toBeNull();
    expect(coursiclePageUrl('Free elective')).toBeNull();
  });
});

describe('CourseCard reviews link', () => {
  const href = 'href="https://www.coursicle.com/rochester/courses/CSC/171/"';

  it('shows a Reviews chip on a placed course that opens in a new tab', () => {
    const html = renderToString(<CourseCard placed course={course()} />);
    expect(html).toContain(href);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('>Reviews<');
  });

  it('shows an icon link on a catalog course', () => {
    const html = renderToString(<CourseCard course={course()} onAdd={() => {}} />);
    expect(html).toContain(href);
    expect(html).toContain('Read reviews of CSC 171 on Coursicle');
  });

  it('omits the link when the code has no Coursicle page', () => {
    const html = renderToString(<CourseCard placed course={course({ id: 'BIOL 000' })} />);
    expect(html).not.toContain('coursicle.com');
  });
});
