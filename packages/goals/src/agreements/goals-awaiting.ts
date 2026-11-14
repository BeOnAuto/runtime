import { agreementStanding, goalAgreementsIn, goalStandingIn } from '@on.auto/definitions/goals';
import { Effect } from 'effect';

export const goalsAwaitingAYesIn = Effect.gen(function* () {
  const standing = yield* goalStandingIn;
  const agreements = yield* goalAgreementsIn;
  return standing.goals.some((goal) => goal.retired !== true && agreementStanding(goal, agreements) === undefined);
});
