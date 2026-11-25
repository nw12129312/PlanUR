import { describe, it, expect } from 'vitest';
import { feedbackUrl, environmentInfo } from '../src/feedback.js';

const fakeWindow = {
  navigator: { userAgent: 'TestBrowser/1.0', language: 'en-US' },
  innerWidth: 1280, innerHeight: 800,
  screen: { width: 1920, height: 1080 }, devicePixelRatio: 2,
  location: { origin: 'https://example.test', pathname: '/PlanUR/', href: 'https://example.test/PlanUR/?x=1' },
};

describe('feedback links', () => {
  it('opens the bug form with browser details', () => {
    const url = new URL(feedbackUrl('bug', fakeWindow));
    expect(url.origin + url.pathname).toBe('https://github.com/nw12129312/PlanUR/issues/new');
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    expect(url.searchParams.get('title')).toBe('Bug: ');
    const env = url.searchParams.get('environment');
    expect(env).toContain('TestBrowser/1.0');
    expect(env).toContain('Window: 1280 x 800');
    expect(env).toContain('Page: https://example.test/PlanUR/');
    expect(env).not.toContain('?x=1');
  });

  it('opens the feedback form, and falls back to it for unknown kinds', () => {
    expect(new URL(feedbackUrl('feedback', fakeWindow)).searchParams.get('template')).toBe('feedback.yml');
    expect(new URL(feedbackUrl('nope', fakeWindow)).searchParams.get('template')).toBe('feedback.yml');
  });

  it('works without a window', () => {
    expect(environmentInfo(undefined)).toContain('Browser: unknown');
  });
});
