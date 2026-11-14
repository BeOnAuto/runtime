import { activityOperationsOf, commentChanges, orgCommentOperations } from '@on.auto/activity';
import type { AppRuntime } from '@on.auto/api';
import { connectionChanges } from '@on.auto/connections';
import type { DispatcherServices } from '@on.auto/operations';
import { defineListOrgChanges, playbookChanges, playbookOperationsOf } from '@on.auto/playbooks';

import { playbookGoalsServedBy } from '../goals/reads/served-playbook-goals.ts';
import { importOperationsOf } from '../importing/import-operations.ts';
import type { ServedGoals, ServedPages } from './playbook-operations.ts';
import { playbookPagesServedBy } from './served-playbook-pages.ts';
import type { ServedReasoning } from './served-reasoning.ts';

const orgChanges = defineListOrgChanges([playbookChanges, connectionChanges, commentChanges]);

function orgOperationsOfPlaybooks(
  runtime: AppRuntime<DispatcherServices>,
  served: ServedPages & Pick<ServedGoals, 'goals' | 'messages'>,
) {
  const goals = served.goals ? playbookGoalsServedBy(runtime, served.pages, served.messages) : undefined;
  return [
    ...playbookOperationsOf(playbookPagesServedBy(runtime, served.pages), goals),
    orgChanges,
    ...activityOperationsOf(goals),
    ...orgCommentOperations,
  ];
}

type ImportsServed = Parameters<typeof importOperationsOf>[1];

export function orgPartsServedBy<Operation>(
  runtime: AppRuntime<DispatcherServices>,
  served: ImportsServed & ServedReasoning,
  inOrg: readonly Operation[],
) {
  const { listModels, getVoice, transcribe } = served;
  return {
    importsOver: importOperationsOf(runtime, served),
    orgOperations: [...orgOperationsOfPlaybooks(runtime, served), listModels, getVoice, transcribe, ...inOrg],
  };
}
