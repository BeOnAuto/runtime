import { goalAgreementsIn, goalStandingIn } from '@on.auto/definitions/goals';
import { defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { observationGapsIn } from '../gaps/observation-gaps.ts';
import { noticeGapsIn } from '../notices/notice-gaps.ts';
import type { Assessments } from './assessments-schema.ts';
import { goalAssessmentsIn } from './goal-assessments.ts';
import { GoalsReadSchema } from './goals-read-schema.ts';
import { goalsReadOf } from './goals-read.ts';
import type { NoticesDelivered } from './notices-delivered.ts';

const description = [
  "Reads the playbook's goals as written, what the playbook and each goal still lack,",
  'what each workflow that is not retired does for each goal, and how each goal is being judged.',
  'A playbook with no goals answers none, and says so among its gaps.',
].join(' ');

const NoInput = Schema.Never.annotate({ message: 'get_playbook_goals takes no query parameters; send none' });

export function goalsReadWith(delivered?: NoticesDelivered) {
  return Effect.gen(function* () {
    const standing = yield* goalStandingIn;
    const assessed = yield* Effect.forEach(standing.goals, (goal) =>
      Effect.map(
        goalAssessmentsIn(goal, delivered, standing.version),
        (assessments): readonly [string, Assessments] => [goal.id, assessments],
      ),
    );
    const byGoal = new Map(assessed);
    const engineGaps = [...(yield* noticeGapsIn(standing.goals)), ...(yield* observationGapsIn(standing))];
    return goalsReadOf(standing, (goal) => byGoal.get(goal.id), engineGaps, yield* goalAgreementsIn);
  });
}

export const goalsReadIn = goalsReadWith();

function getPlaybookGoalsJudged(results: boolean) {
  return defineHttpOperation('playbook', 'query', {
    name: 'get_playbook_goals',
    title: 'Get playbook goals',
    description,
    route: { method: 'GET', path: '/goals' },
    body: { kind: 'none' },
    inputSchema: Schema.Record(Schema.String, NoInput),
    outputSchema: GoalsReadSchema,
    reasons: [],
    handle: () => Effect.map(goalsReadIn, (read) => ({ ...read, results })),
  });
}

export const getPlaybookGoals = getPlaybookGoalsJudged(false);

export const getJudgedPlaybookGoals = getPlaybookGoalsJudged(true);
