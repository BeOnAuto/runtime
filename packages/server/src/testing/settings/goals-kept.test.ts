import { goalsCheckedOf } from '@on.auto/goals';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { goalsText, leadGoalId, plainGoalId, restatedGoalsText } from './goals-kept.ts';

const naming = { name: 'Growth', description: 'Experiments that bring customers' };

const at = Date.UTC(2026, 10, 9, 12);

describe('the goals text of the testing helpers', () => {
  it.each([goalsText, restatedGoalsText])(
    'passes the real check, a goal with milestones and a window beside one without',
    (source) => {
      const checked = goalsCheckedOf(source, naming, at);

      expect(Result.isSuccess(checked)).toBe(true);
      expect(Result.getOrThrow(checked).goals.map(({ id }) => id)).toEqual([leadGoalId, plainGoalId]);
    },
  );
});
