import { describe, expect, it } from 'vitest';

import { markdownOf, paragraph, type DefinitionUser, type PhrasedDefinition } from '../index.ts';
import { callerSentence } from './caller-words.ts';

function writtenOf(user: DefinitionUser): string | undefined {
  return markdownOf({
    title: 'send-build',
    opening: [],
    body: [paragraph(...callerSentence(user))],
    sections: [],
    appendix: [],
  })
    .trimEnd()
    .split('\n\n')
    .at(-1);
}

describe('the sentence of a definition that uses another', () => {
  it('says what it does with it in the words of its relation, the user by its title or its name in words', () => {
    const users: readonly DefinitionUser[] = [
      { type: 'prediction', name: 'weekly-orders', relation: 'sends-builds' },
      { type: 'prediction', name: 'demand', relation: 'asks-approval' },
      { type: 'recall', name: 'review-history', relation: 'remembers-runs' },
      { type: 'recall', name: 'brief-changes', relation: 'remembers-changes' },
      { type: 'workflow', name: 'weekly-review', title: 'The weekly review', relation: 'calls' },
      { type: 'echo', name: 'greets', relation: 'calls' },
    ];

    expect(users.map((user) => writtenOf(user))).toEqual([
      'The prediction function **Weekly orders** sends it builds to train.',
      'The prediction function **Demand** asks it to approve a version.',
      'The recall function **Review history** remembers its runs.',
      'The recall function **Brief changes** remembers its changes.',
      'The workflow **The weekly review** calls it.',
      'The echo definition **Greets** calls it.',
    ]);
  });
});

describe('the sentence of a workflow that calls a definition', () => {
  it('says the steps it calls it in, each by its number and its name in words, in one sentence', () => {
    const calling: PhrasedDefinition = {
      type: 'workflow',
      name: 'monthly-website-report',
      title: 'Monthly website report',
    };

    expect([
      writtenOf({ ...calling, relation: 'calls', steps: [{ number: 3, name: 'approve_the-report' }] }),
      writtenOf({
        ...calling,
        relation: 'calls',
        steps: [
          { number: 3, name: 'review' },
          { number: 6, name: 'review-again' },
        ],
      }),
      writtenOf({
        ...calling,
        relation: 'calls',
        steps: [
          { number: 1, name: 'draft' },
          { number: 3, name: 'review' },
          { number: 6, name: 'review-again' },
        ],
      }),
    ]).toEqual([
      'The workflow **Monthly website report** calls it in step 3, **Approve the report**.',
      'The workflow **Monthly website report** calls it in step 3, **Review**, and in step 6, **Review again**.',
      'The workflow **Monthly website report** calls it in step 1, **Draft**, in step 3, **Review**, and in step 6, **Review again**.',
    ]);
  });
});
