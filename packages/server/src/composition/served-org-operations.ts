import { activityOperations, commentChanges, orgCommentOperations } from '@on.auto/activity';
import type { AppRuntime } from '@on.auto/api';
import { connectionChanges } from '@on.auto/connections';
import type { SubjectPages } from '@on.auto/definitions/page';
import type { DispatcherServices } from '@on.auto/operations';
import { defineListOrgChanges, playbookChanges, playbookOperationsOf } from '@on.auto/playbooks';

import { playbookPagesServedBy } from './served-playbook-pages.ts';

const orgChanges = defineListOrgChanges([playbookChanges, connectionChanges, commentChanges]);

export function orgOperationsOfPlaybooks(runtime: AppRuntime<DispatcherServices>, pages: SubjectPages) {
  return [
    ...playbookOperationsOf(playbookPagesServedBy(runtime, pages)),
    orgChanges,
    ...activityOperations,
    ...orgCommentOperations,
  ];
}
