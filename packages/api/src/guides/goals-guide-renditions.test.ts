import { describe, expect, it } from 'vitest';

import { goalsGuideIn } from './goals-guide-renditions.ts';

const marked = [
  '# Goals',
  '',
  'Learn what it should achieve.',
  '',
  '<!-- with messages -->',
  '',
  'Ask what to tell them, and where.',
  '',
  '<!-- end -->',
  '',
  '<!-- without messages -->',
  '',
  'Ask nothing about being told.',
  '',
  '<!-- end -->',
  '',
  '```',
  '- id: orders',
  '<!-- with messages -->',
  '  notify:',
  '    passed: now',
  '<!-- end -->',
  '  retired: false',
  '```',
  '',
  'The end.',
  '',
].join('\n');

describe('the goals guide in its two renditions', () => {
  it('keeps the lines of messages and drops the others where messages are on, each marker gone with the blank line after it', () => {
    expect(goalsGuideIn(marked, { messages: true })).toBe(
      [
        '# Goals',
        '',
        'Learn what it should achieve.',
        '',
        'Ask what to tell them, and where.',
        '',
        '```',
        '- id: orders',
        '  notify:',
        '    passed: now',
        '  retired: false',
        '```',
        '',
        'The end.',
        '',
      ].join('\n'),
    );
  });

  it('keeps the lines without messages and drops the others where messages are off, leaving single blank lines', () => {
    expect(goalsGuideIn(marked, { messages: false })).toBe(
      [
        '# Goals',
        '',
        'Learn what it should achieve.',
        '',
        'Ask nothing about being told.',
        '',
        '```',
        '- id: orders',
        '  retired: false',
        '```',
        '',
        'The end.',
        '',
      ].join('\n'),
    );
  });
});

describe('the marked text of the goals guide', () => {
  it('leaves a text with no markers as it is', () => {
    expect(goalsGuideIn('# Goals\n\nNo blocks.\n', { messages: false })).toBe('# Goals\n\nNo blocks.\n');
  });

  it('refuses a block opened inside another, an end with no block, and a block never ended, naming the line', () => {
    expect(() =>
      goalsGuideIn('<!-- with messages -->\n<!-- without messages -->\n<!-- end -->\n', { messages: true }),
    ).toThrow('The goals guide opens a block on line 2 inside the block opened on line 1');
    expect(() => goalsGuideIn('Text\n<!-- end -->\n', { messages: true })).toThrow(
      'The goals guide ends a block on line 2 that was never opened',
    );
    expect(() => goalsGuideIn('<!-- without messages -->\nText\n', { messages: false })).toThrow(
      'The goals guide opens a block on line 1 and never ends it',
    );
  });
});
