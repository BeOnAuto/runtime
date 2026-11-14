import { goalsText, leadGoalId, plainGoalId } from '@on.auto/playbooks/testing';
import { describe, expect, it } from 'vitest';

import { wordsIn } from './goal-words.ts';

describe('the words of the verdicts of goals', () => {
  it('are each goal’s own, for passed and for failed, read from the goals as saved', () => {
    expect(wordsIn(goalsText)).toEqual(
      new Map([
        [leadGoalId, { passed: 'Brought a customer', failed: 'Brought no customer' }],
        [plainGoalId, { passed: 'Orders came in', failed: 'Orders fell short' }],
      ]),
    );
  });

  it('are none for a playbook with no goals, or goals that no longer read as goals', () => {
    expect(wordsIn()).toEqual(new Map());
    expect(wordsIn('not goals')).toEqual(new Map());
  });
});
