import { Schema } from 'effect';

import type { OperationKind, OperationScope } from './operation-scope.ts';

export const PermissionSchema = Schema.Literals(['org:read', 'org:write', 'playbook:read', 'playbook:write']);

export type Permission = typeof PermissionSchema.Type;

export const allPermissions: readonly Permission[] = PermissionSchema.literals;

const accessByKind: Readonly<Record<OperationKind, 'read' | 'write'>> = { query: 'read', command: 'write' };

export function permissionFor(kind: OperationKind, scope: OperationScope): Permission {
  return `${scope}:${accessByKind[kind]}`;
}
