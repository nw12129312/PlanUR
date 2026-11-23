import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { CourseCard } from '../src/ui/CourseCard.jsx';

function course(overrides = {}) {
  return {
    id: 'CSC 242', dept: 'CSC', number: 242, suffix: '',
    title: 'Artificial Intelligence', credits: 4, creditsVerified: true,
    offered: ['fall'], offeredClaim: [], offeredVerified: true,
    prereqs: [], prereqsVerified: true, prereqNote: null, prereqSource: null,
    instructors: [],
    description: '', source: 'test', stub: false,
    crossListings: [],
    ...overrides,
  };
}

describe('CourseCard cross-list chip', () => {
  it('omits the chip when the course has no other listings', () => {
    const html = renderToString(<CourseCard placed course={course()} />);
    expect(html).not.toContain('Cross-listed');
  });

  it('names the other codes when there are one or two aliases', () => {
    const html = renderToString(
      <CourseCard placed course={course({
        crossListings: ['DSCC 242', 'BCSC 232'],
        crossListingSource: 'CDCS Co-Located',
      })} />,
    );
    expect(html).toContain('Cross-listed DSCC 242 · BCSC 232');
    expect(html).toContain('Same class as DSCC 242, BCSC 232');
  });
});
