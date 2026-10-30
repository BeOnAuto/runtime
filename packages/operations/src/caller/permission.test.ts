import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  PermissionSchema,
  allPermissions,
  permissionFor,
  type OperationKind,
  type Permission,
  type OperationScope,
} from '../index.ts';

const derived: ReadonlyArray<readonly [OperationKind, OperationScope, Permission]> = [
  ['query', 'org', 'org:read'],
  ['command', 'org', 'org:write'],
  ['query', 'playbook', 'playbook:read'],
  ['command', 'playbook', 'playbook:write'],
];

describe('permissions', () => {
  it('are four, one per scope and access', () => {
    expect(allPermissions).toEqual(['org:read', 'org:write', 'playbook:read', 'playbook:write']);
  });

  it.each(derived)('make a %s at %s scope need %s', (kind, scope, permission) => {
    expect(permissionFor(kind, scope)).toBe(permission);
  });

  it('decode only the four names', () => {
    const isPermission = Schema.is(PermissionSchema);

    expect(allPermissions.every((permission) => isPermission(permission))).toBe(true);
    expect(isPermission('org:admin')).toBe(false);
  });
});
