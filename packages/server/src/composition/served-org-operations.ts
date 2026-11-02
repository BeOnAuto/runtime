import { activityOperations, commentChanges, orgCommentOperations } from '@on.auto/activity';
import { connectionChanges } from '@on.auto/connections';
import { defineListOrgChanges, playbookChanges, playbookOperations } from '@on.auto/playbooks';

const orgChanges = defineListOrgChanges([playbookChanges, connectionChanges, commentChanges]);

export const orgOperationsOfPlaybooks = [
  ...playbookOperations,
  orgChanges,
  ...activityOperations,
  ...orgCommentOperations,
];
