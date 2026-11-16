import { Context } from 'effect';

import type { RoleAssignments } from './role-assignments.ts';

export const CallerRoles = Context.Reference<RoleAssignments | null>('@on.auto/access-control/CallerRoles', {
  defaultValue: () => null,
});
