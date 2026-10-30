import type { ProtectedResource } from '@on.auto/identity';
import { allPermissions, canAccessPlaybook, type CallerIdentity } from '@on.auto/operations';

import type { Problem } from '../problem/problem-document.ts';
import { problemOf, problemResponse } from '../problem/problem.ts';
import { callerOfAnotherOrg, endpointPathOf, insufficientScope, namesAnEndpoint } from './challenges.ts';

const anotherPlaybook = problemOf('forbidden', 'The caller may not access this playbook');

const noSuchOrg = problemOf('not_found', 'There is no such org');

const noSuchPlaybook = problemOf('not_found', 'There is no such playbook in this org');

type Judged = { readonly caller: CallerIdentity } | { readonly refusal: Problem };

export type Admission = { readonly caller: CallerIdentity } | { readonly refused: Response };

function judged(caller: CallerIdentity | undefined, org: string, playbook: string | undefined): Judged {
  if (caller === undefined) {
    return { refusal: callerOfAnotherOrg };
  }
  if (playbook !== undefined && !canAccessPlaybook(caller.playbooks, playbook)) {
    return { refusal: anotherPlaybook };
  }
  if (!namesAnEndpoint(org)) {
    return { refusal: noSuchOrg };
  }
  return namesAnEndpoint(org, playbook) ? { caller } : { refusal: noSuchPlaybook };
}

function refused(problem: Problem, resource: ProtectedResource | undefined, path: string): Response {
  return problemResponse(
    problem,
    problem.reason === 'forbidden' ? insufficientScope(resource, allPermissions, path) : {},
  );
}

export function admissionAt(
  caller: CallerIdentity | undefined,
  org: string,
  playbook: string | undefined,
  resource: ProtectedResource | undefined,
): Admission {
  const judgement = judged(caller, org, playbook);
  return 'refusal' in judgement
    ? { refused: refused(judgement.refusal, resource, endpointPathOf(org, playbook)) }
    : judgement;
}
