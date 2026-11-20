import { playbookGoalsIn } from '@on.auto/definitions/goals';
import { Effect } from 'effect';

export const goalsAwaitingAYesIn = Effect.map(playbookGoalsIn, ({ held }) =>
  held.some(({ goal, agreed }) => goal.retired !== true && agreed === undefined),
);
