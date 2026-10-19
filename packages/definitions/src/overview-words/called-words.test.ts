import { describe, expect, it } from 'vitest';

import { markdownOf, paragraph, type DefinitionCalled } from '../index.ts';
import { calledSentence } from './called-words.ts';

function writtenOf(called: DefinitionCalled): string {
  return markdownOf({
    title: 'monthly-website-report',
    opening: ['Reports a month'],
    body: [paragraph(...calledSentence(called))],
    sections: [],
    appendix: [],
  })
    .trimEnd()
    .split('# monthly-website-report\n\nReports a month\n\n')
    .join('');
}

describe('the sentence of a definition a workflow calls', () => {
  it('names it by its title or its name in words and gives the first paragraph of its description after a colon, as written', () => {
    const called: readonly DefinitionCalled[] = [
      {
        type: 'computation',
        name: 'month-window',
        standing: 'active',
        description: '  Turns a month such as 2026-04 into its date range  \n \nThe rest of what it says.',
      },
      {
        type: 'workflow',
        name: 'weekly-review',
        title: 'The weekly review',
        standing: 'active',
        description: 'Reviews.',
      },
      { type: 'reasoning', name: 'write-report', standing: 'active', description: 'Writes *the* report\nfor the team' },
    ];

    expect(called.map((definition) => writtenOf(definition))).toEqual([
      'It calls the computation function **Month window**: Turns a month such as 2026-04 into its date range.',
      'It calls the workflow **The weekly review**: Reviews.',
      'It calls the reasoning function **Write report**: Writes *the* report\nfor the team.',
    ]);
  });

  it('says one without a description in the sentence alone, and one that is retired or that the playbook does not have', () => {
    const called: readonly DefinitionCalled[] = [
      { type: 'reasoning', name: 'write-report', standing: 'active', description: ' \n' },
      { type: 'reasoning', name: 'review-brief', standing: 'active' },
      { type: 'interaction', name: 'approve-report', standing: 'retired', description: 'Asks for an approval' },
      { type: 'computation', name: 'month-window', standing: 'missing' },
    ];

    expect(called.map((definition) => writtenOf(definition))).toEqual([
      'It calls the reasoning function **Write report**.',
      'It calls the reasoning function **Review brief**.',
      'It calls the interaction function **Approve report**, which is retired.',
      'It calls the computation function **Month window**, which the playbook does not have yet.',
    ]);
  });
});
