import { assignRole } from './assign-role.ts';
import { listRoleAssignments } from './list-role-assignments.ts';
import { unassignRole } from './unassign-role.ts';

export const roleAssignmentOperations = [listRoleAssignments, assignRole, unassignRole];
