import { goalsText } from '@on.auto/playbooks/testing';

import { servingReasoning, type ReasoningServer } from '../servers/reasoning-server.ts';
import type { ServedParts } from '../servers/served-parts.ts';

export { goalsText, goalsTextGaps, leadGoalId, plainGoalId, restatedGoalsText } from '@on.auto/playbooks/testing';

type Serving = Parameters<typeof servingReasoning>;

export function servingReasoningWithGoals(
  replies: Serving[0],
  environment?: Serving[1],
  fetch?: Serving[2],
  parts: ServedParts = {},
): Promise<ReasoningServer> {
  return servingReasoning(replies, environment, fetch, {
    goalsResults: true,
    goalsMessages: true,
    ...parts,
    goals: true,
  });
}

interface Creating {
  readonly playbook?: string;
  readonly name?: string;
  readonly goals?: string;
}

export function createdWithGoals(
  { call }: Pick<ReasoningServer, 'call'>,
  { playbook = 'alpha', name = 'Alpha', goals = goalsText }: Creating = {},
) {
  return call('POST', '/v1/orgs/acme/playbooks', { body: { playbook, name, goals } });
}

/**
 * Goals given to a playbook whose test is about something else, since a server keeps goals and a playbook with no
 * goals takes no workflow: one goal with no window, milestone or measure and every notice quiet, so the goals engine
 * opens nothing and tells no one, and each workflow contributes to it.
 */
const GIVEN_GOAL = 'kept-going';

export const givenGoals = [
  `- id: ${GIVEN_GOAL}`,
  '  statement: The playbook keeps doing its work.',
  '  success:',
  '    label: Runs that ended',
  '    settles: on_crossing',
  '    target: { at_least: 0 }',
  '    passed: Kept going',
  '    failed: Stopped',
  '  notify: { passed: quiet, failed: quiet }',
  '',
].join('\n');

const contribution = ['contributes:', `  - goal: ${GIVEN_GOAL}`, '    purpose: Does the work the test asks of it.'];

/** The workflow's source with what it contributes to the given goal, before its `do` list. */
export function contributing(source: string): string {
  return source.replace(/^do:/mu, [...contribution, 'do:'].join('\n'));
}
