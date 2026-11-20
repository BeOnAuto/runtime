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

export const defaultRoleIds = ['editor', 'viewer'] as const satisfies readonly BuiltInRoleId[];

export type DefaultRoleId = (typeof defaultRoleIds)[number];

export interface RolesAtSignIn {
  readonly bootstrap: BuiltInRoleId;
  readonly enrolment: DefaultRoleId;
}

export const builtInRolesAtSignIn: RolesAtSignIn = { bootstrap: 'admin', enrolment: 'viewer' };

function permitsNoMoreThan(table: RoleTable, held: BuiltInRoleId, asked: BuiltInRoleId): boolean {
  return table[asked].permits.every((permission) => table[held].permits.includes(permission));
}

export function mayAssign(table: RoleTable, held: BuiltInRoleId, asked: BuiltInRoleId): boolean {
  return table[held].assignsRoles && permitsNoMoreThan(table, held, asked);
}

const invitingPermission: Permission = 'org:write';

export function mayInvite(table: RoleTable, held: BuiltInRoleId, asked: BuiltInRoleId): boolean {
  const holder = table[held];
  return (
    holder.permits.includes(invitingPermission) &&
    permitsNoMoreThan(table, held, asked) &&
    (holder.assignsRoles || !table[asked].assignsRoles)
  );
}
