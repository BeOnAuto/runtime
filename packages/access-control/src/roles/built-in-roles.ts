import type { Permission } from '@on.auto/operations';

export const builtInRoleIds = ['admin', 'editor', 'viewer'] as const;

export type BuiltInRoleId = (typeof builtInRoleIds)[number];

interface BuiltInRole {
  readonly permits: readonly Permission[];
  readonly assignsRoles: boolean;
}

export type RoleTable = Readonly<Record<BuiltInRoleId, BuiltInRole>>;

const everyPermission: readonly Permission[] = ['org:read', 'org:write', 'playbook:read', 'playbook:write'];

export const builtInRoles: RoleTable = {
  admin: { permits: everyPermission, assignsRoles: true },
  editor: { permits: everyPermission, assignsRoles: false },
  viewer: { permits: ['org:read', 'playbook:read'], assignsRoles: false },
};

export interface RolesAtSignIn {
  readonly bootstrap: BuiltInRoleId;
  readonly enrolment: BuiltInRoleId;
}

export const builtInRolesAtSignIn: RolesAtSignIn = { bootstrap: 'admin', enrolment: 'viewer' };

export function mayAssign(table: RoleTable, held: BuiltInRoleId, asked: BuiltInRoleId): boolean {
  const holder = table[held];
  return holder.assignsRoles && table[asked].permits.every((permission) => holder.permits.includes(permission));
}
