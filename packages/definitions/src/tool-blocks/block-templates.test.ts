import { describe, expect, it } from 'vitest';

import { issueText } from '../document/document-issue.ts';
import { standingRenderClock } from '../testing/time/stepping-clock.ts';
import { templateIssues, templatesIssues } from './block-templates.ts';
import type { TemplateSet } from './template-sets.ts';

const keyOfAReading: TemplateSet = {
  names: ['to', 'sent.conversation', 'sent.id'],
  what: 'the key of a reading',
  sample: { to: 'ada', sent: { conversation: 'C0123', id: '1699.1' } },
  structured: 'sent',
};

const place = { lines: new Map([['/key', 3]]), pointer: '/key', inputSchema: undefined, clock: standingRenderClock };

function problemsOf(text: string): readonly string[] {
  return templateIssues(keyOfAReading, text, place).map((issue) => issueText(issue));
}

describe('a template that renders text', () => {
  it('takes the names of its set, a name nested under one of them among them', () => {
    expect([problemsOf('{{ sent.conversation }}/{{ sent.id }}'), problemsOf('{{ to }}')]).toEqual([[], []]);
  });

  it('refuses a template that uses more names than a template may', () => {
    expect(problemsOf('{{ to }}'.repeat(1100))).toEqual([
      expect.stringContaining('A template may use at most 1000 names'),
    ]);
  });

  it('refuses a name its set does not have, naming the names it reads', () => {
    expect([problemsOf('{{ since }}'), problemsOf('{{ sent.thread }}')]).toEqual([
      [expect.stringContaining('Line 3, /key:')],
      [expect.stringContaining('Line 3, /key:')],
    ]);
  });

  it('refuses a structure it renders as text, alone or among text, naming the structured value of its set', () => {
    expect([problemsOf('{{ sent }}'), problemsOf('At {{ sent }}')]).toEqual([
      [expect.stringContaining('Line 3, /key:')],
      [expect.stringContaining('Line 3, /key:')],
    ]);
  });
});

describe('the templates of a block', () => {
  it('are checked at the path of each, inside lists and objects, and a value that is no string is taken', () => {
    const issues = templatesIssues(keyOfAReading, { limit: 15, parts: [{ text: '{{ since }}' }], flag: true }, place);

    expect(issues.map(({ pointer }) => pointer)).toEqual(['/key/parts/0/text']);
  });
});
