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
