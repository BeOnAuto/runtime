import type { CallerIdentity, Outcome } from '@on.auto/operations';

import { acmeAdmin } from './callers.ts';
import { goalsText } from './goals-texts.ts';
import { toOrg, type Harness } from './harness.ts';

interface Creating {
  readonly playbook?: string;
  readonly name?: string;
  readonly goals?: string;
  readonly caller?: CallerIdentity;
}

export function createdWithGoals(
  { call }: Pick<Harness, 'call'>,
  operation: Parameters<Harness['call']>[0],
  { playbook = 'alpha', name = 'Alpha', goals = goalsText, caller = acmeAdmin }: Creating = {},
): Promise<Outcome> {
  return call(operation, toOrg('acme')(caller, { playbook, name, goals }));
}
