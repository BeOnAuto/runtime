import { connectionChanges } from '@on.auto/connections';
import { defineListOrgChanges, playbookChanges, playbookOperations } from '@on.auto/playbooks';

const orgChanges = defineListOrgChanges([playbookChanges, connectionChanges]);

export const orgOperationsOfPlaybooks = [...playbookOperations, orgChanges];
