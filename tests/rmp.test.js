import { describe, it, expect } from 'vitest';

import rmpData from '../src/data/rmp.json';
import {
  rmpCompactLine, rmpDetailLines, rmpForInstructor, rmpPageUrl,
} from '../src/engine/rmp.js';

describe('rmpForInstructor', () => {
  it('matches a CDCS name to the RateMyProfessors record', () => {
    const rec = rmpForInstructor('Ted Pawlicki', rmpData);
    expect(rec.id).toBe(22421);
    expect(rec.rating).toBe(2.1);
    expect(rec.numRatings).toBe(171);
  });

  it('drops a middle name when first and last still uniquely match', () => {
    const rec = rmpForInstructor('Coraline Rinn Iordan', rmpData);
    expect(rec.last).toBe('Iordan');
    expect(rec.first).toBe('Coraline');
  });

  it('matches a nickname when the last name is unique', () => {
    const rec = rmpForInstructor('Bob Minckley', rmpData);
    expect(rec.first).toBe('Robert');
    expect(rec.last).toBe('Minckley');
  });

  it('matches Monika Polak from the CDCS CSC 172 listing', () => {
    const rec = rmpForInstructor('Monika Polak', rmpData);
    expect(rec.rating).toBe(3.7);
    expect(rec.numRatings).toBe(12);
  });

  it('does not invent a rating for an unmatched name', () => {
    expect(rmpForInstructor('Definitely Not A Professor', rmpData)).toBeNull();
    expect(rmpForInstructor('', rmpData)).toBeNull();
  });
});

describe('rmp display helpers', () => {
  it('formats compact metrics used next to names in the multi-instructor list', () => {
    const rec = rmpForInstructor('Ted Pawlicki', rmpData);
    expect(rmpCompactLine(rec)).toBe('2.1/5 · 171');
    expect(rmpDetailLines(rec).join(' ')).toMatch(/Quality 2\.1 \/ 5/);
    expect(rmpDetailLines(rec).join(' ')).toMatch(/171 ratings/);
    expect(rmpPageUrl(rec)).toBe('https://www.ratemyprofessors.com/professor/22421');
  });

  it('says so when there is no listing instead of fabricating numbers', () => {
    expect(rmpCompactLine(null)).toBe('');
    expect(rmpDetailLines(null)[0]).toMatch(/No RateMyProfessors listing/);
  });
});

describe('rmpLinkForInstructor', () => {
  it('links a matched name to the professor page', async () => {
    const { rmpLinkForInstructor } = await import('../src/engine/rmp.js');
    const link = rmpLinkForInstructor('Ted Pawlicki', rmpData);
    expect(link.exact).toBe(true);
    expect(link.href).toBe('https://www.ratemyprofessors.com/professor/22421');
  });

  it('falls back to a school search for an unmatched name', async () => {
    const { rmpLinkForInstructor } = await import('../src/engine/rmp.js');
    const link = rmpLinkForInstructor("Jane O'Nobody", rmpData);
    expect(link.exact).toBe(false);
    expect(link.href).toBe("https://www.ratemyprofessors.com/search/professors/1331?q=Jane%20O'Nobody");
  });
});
