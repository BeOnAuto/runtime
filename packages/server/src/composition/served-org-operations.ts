import { getCaller, roleAssignmentOperations } from '@on.auto/access-control';
import { activityOperationsOf, orgCommentOperations } from '@on.auto/activity';
import { requestsSetAsideBy } from '@on.auto/goals';
import { playbookOperationsOf } from '@on.auto/playbooks';

import { playbookGoalsReadBy, playbookGoalsServedBy } from '../goals/reads/served-playbook-goals.ts';
import { importOperationsOf } from '../importing/import-operations.ts';
import type {
  ServedConnectionAccess,
  ServedConnectionEvents,
  ServedGoals,
  ServedPages,
} from './playbook-operations.ts';
import { playbookPagesServedBy } from './served-playbook-pages.ts';
import type { ServedReasoning } from './served-reasoning.ts';

type ServingRuntime = Parameters<typeof importOperationsOf>[0];

type Capabilities = Parameters<ReturnType<typeof importOperationsOf>>[0];

type ServedPlaybooks = ServedPages & Pick<ServedGoals, 'goals' | 'messages'>;

function playbookOperationsOver(runtime: ServingRuntime, served: ServedPlaybooks) {
  return (capabilities: Capabilities) =>
    playbookOperationsOf(
      playbookPagesServedBy(runtime, served.pages),
      served.goals ? playbookGoalsServedBy(runtime, served.pages, served.messages, capabilities) : undefined,
    );
}

function orgOperationsOfPlaybooks(runtime: ServingRuntime, served: ServedPlaybooks) {
  const read = served.goals ? playbookGoalsReadBy(runtime, served.pages) : undefined;
  return [
    ...activityOperationsOf(read === undefined ? undefined : { read, setAside: requestsSetAsideBy }),
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
  const playbooksOver = playbookOperationsOver(runtime, served);
  const importsOver = importOperationsOf(runtime, served);
  return {
    playbooksOver: (capabilities: Capabilities) => ({
      playbooks: playbooksOver(capabilities),
      imports: importsOver(capabilities),
    }),
    connections: served.connections,
    connectionEvents: served.connectionEvents,
    orgOperations: [...orgOperationsOfPlaybooks(runtime, served), listModels, getVoice, transcribe, ...inOrg],
  };
}
