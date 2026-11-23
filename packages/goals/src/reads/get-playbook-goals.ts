import { goalStandingIn } from '@on.auto/definitions/goals';
import { defineHttpOperation } from '@on.auto/operations';
import { Effect } from 'effect';

import { readWithTheConnections, type ServerConnected } from '../connections/goal-connections.ts';
import { observationGapsIn } from '../gaps/observation-gaps.ts';
import { noticeGapsIn } from '../notices/notice-gaps.ts';
import { goalAssessmentsIn, type GoalsAsked } from './goal-assessments.ts';
import { GoalsQuerySchema, GoalsReadSchema } from './goals-read-schema.ts';
import { goalsReadOf } from './goals-read.ts';
import type { NoticesDelivered } from './notices-delivered.ts';

const description = [
  "Reads the playbook's goals as written, what the playbook and each goal still lack,",
  'what each workflow that is not retired does for each goal, and how each goal is being judged.',
  'A playbook with no goals answers none, and says so among its gaps.',
].join(' ');

export function goalsReadWith(delivered?: NoticesDelivered, connected?: ServerConnected, asked: GoalsAsked = {}) {
  return Effect.gen(function* () {
    const standing = yield* goalStandingIn;
    const assessed = yield* Effect.forEach(standing.held, (held) => goalAssessmentsIn(held, delivered, asked));
    const byGoal = new Map(standing.held.map(({ goal }, index) => [goal.id, assessed[index]]));
    const engineGaps = [...(yield* noticeGapsIn(standing.held)), ...(yield* observationGapsIn(standing))];
    const read = goalsReadOf(standing, (goal) => byGoal.get(goal.id), engineGaps);
    return yield* readWithTheConnections(read, standing.workflows, connected);
  });
}

export const goalsReadIn = goalsReadWith();

export function getPlaybookGoalsJudged(results: boolean, connected?: ServerConnected) {
  return defineHttpOperation('playbook', 'query', {
    name: 'get_playbook_goals',
    staleOn: [{ kind: 'goal' }, { kind: 'connection' }],
    title: 'Get playbook goals',
    description,
    route: { method: 'GET', path: '/goals' },
    body: { kind: 'none' },
    inputSchema: GoalsQuerySchema,
    outputSchema: GoalsReadSchema,
    reasons: ['invalid_input'],
    handle: (asked) => Effect.map(goalsReadWith(undefined, connected, asked), (read) => ({ ...read, results })),
  });
}

export const getPlaybookGoals = getPlaybookGoalsJudged(false);

export const getJudgedPlaybookGoals = getPlaybookGoalsJudged(true);
