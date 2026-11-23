import { Schema } from 'effect';

import type { OperationKind, OperationScope } from './operation-scope.ts';

export const PermissionSchema = Schema.Literals([
  'org:read',
  'org:write',
  'playbook:read',
  'playbook:write',
  'playbook:run',
]);

export type Permission = typeof PermissionSchema.Type;

export const allPermissions: readonly Permission[] = PermissionSchema.literals;

const includingPermissions: Readonly<Partial<Record<Permission, Permission>>> = { 'playbook:run': 'playbook:write' };

export function permissionIncluding(permission: Permission): Permission | undefined {
  return includingPermissions[permission];
}

function includedByAnother(permission: Permission, permissions: readonly Permission[]): boolean {
  const including = permissionIncluding(permission);
  return including !== undefined && permissions.includes(including);
}

export function withIncludedPermissions(permissions: readonly Permission[]): readonly Permission[] {
  return allPermissions.filter(
    (permission) => permissions.includes(permission) || includedByAnother(permission, permissions),
  );
}

export function normalizedPermissions(permissions: readonly Permission[]): readonly Permission[] {
  return permissions.filter((permission) => !includedByAnother(permission, permissions));
}

const accessByKind: Readonly<Record<OperationKind, 'read' | 'write'>> = { query: 'read', command: 'write' };

export function permissionFor(kind: OperationKind, scope: OperationScope): Permission {
  return `${scope}:${accessByKind[kind]}`;
}
