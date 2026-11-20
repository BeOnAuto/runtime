import { getCaller, roleAssignmentOperations } from '@on.auto/access-control';
import { activityOperationsOf, commentChanges, orgCommentOperations } from '@on.auto/activity';
import { connectionChanges } from '@on.auto/connections';
import { requestsSetAsideBy } from '@on.auto/goals';
import { defineListOrgChanges, playbookChanges, playbookOperationsOf } from '@on.auto/playbooks';

import { playbookGoalsServedBy } from '../goals/reads/served-playbook-goals.ts';
import { importOperationsOf } from '../importing/import-operations.ts';
import type {
  ServedConnectionAccess,
  ServedConnectionEvents,
  ServedGoals,
  ServedPages,
} from './playbook-operations.ts';
import { playbookPagesServedBy } from './served-playbook-pages.ts';
import type { ServedReasoning } from './served-reasoning.ts';

const orgChanges = defineListOrgChanges([playbookChanges, connectionChanges, commentChanges]);

type ServingRuntime = Parameters<typeof importOperationsOf>[0];

function orgOperationsOfPlaybooks(
  runtime: ServingRuntime,
  served: ServedPages & Pick<ServedGoals, 'goals' | 'messages'>,
) {
  const goals = served.goals ? playbookGoalsServedBy(runtime, served.pages, served.messages) : undefined;
  return [
    ...playbookOperationsOf(playbookPagesServedBy(runtime, served.pages), goals),
    orgChanges,
    ...activityOperationsOf(goals === undefined ? undefined : { read: goals.read, setAside: requestsSetAsideBy }),
    ...orgCommentOperations,
    ...roleAssignmentOperations,
    getCaller,
  ];
}

type ImportsServed = Parameters<typeof importOperationsOf>[1];

export function orgPartsServedBy<Operation>(
  runtime: ServingRuntime,
  served: ImportsServed & ServedReasoning & ServedConnectionAccess & ServedConnectionEvents,
  inOrg: readonly Operation[],
) {
  const { listModels, getVoice, transcribe } = served;
  return {
    importsOver: importOperationsOf(runtime, served),
    connections: served.connections,
    connectionEvents: served.connectionEvents,
    orgOperations: [...orgOperationsOfPlaybooks(runtime, served), listModels, getVoice, transcribe, ...inOrg],
  };
}
