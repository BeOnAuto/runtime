import { allPermissions, permissionFor, type Permission, type ResourceReference } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import {
  assignARole,
  builtIn,
  createPlaybook,
  decidedBy,
  getDefinition,
  listConnections,
  requestOf,
  rolesHeld,
  runDefinition,
  type TestOperation,
} from '../testing/access-testing.ts';
import { builtInRoleIds, builtInRoles, mayAssign } from './built-in-roles.ts';

const acme: ResourceReference = { type: 'org', id: 'acme' };

const alpha: ResourceReference = { type: 'playbook', id: 'alpha', org: 'acme' };

interface Declaring {
  readonly operation: TestOperation;
  readonly resource: ResourceReference;
}

const declaringEach: Readonly<Record<Permission, Declaring>> = {
  'org:read': { operation: listConnections, resource: acme },
  'org:write': { operation: createPlaybook, resource: acme },
  'playbook:read': { operation: getDefinition, resource: alpha },
  'playbook:write': { operation: runDefinition, resource: alpha },
};

describe('the built-in roles the decider reads', () => {
  it('permit what the built-in policies permit them, permission by permission, so the two never disagree', async () => {
    const decide = decidedBy(
      rolesHeld(Object.fromEntries(builtInRoleIds.map((role) => [`user_${role}`, [builtIn(role, acme)]]))),
      Object.values(declaringEach).map(({ operation }) => operation),
    );
    const decided = await Promise.all(
      builtInRoleIds.flatMap((role) =>
        allPermissions.map(async (permission) => {
          const { operation, resource } = declaringEach[permission];
          const { decision } = await decide(
            requestOf({ principal: { type: 'person', id: `user_${role}` }, operation, resource }),
          );
          return [role, permission, decision === 'allow'] as const;
        }),
      ),
    );

    expect(decided).toEqual(
      builtInRoleIds.flatMap((role) =>
        allPermissions.map((permission) => [role, permission, builtInRoles[role].permits.includes(permission)]),
      ),
    );
  });

  it('manage permissions, signed in to Studio, exactly where the table says they give roles, so the decider and the policies never disagree', async () => {
    const decide = decidedBy(
      rolesHeld(Object.fromEntries(builtInRoleIds.map((role) => [`user_${role}`, [builtIn(role, acme)]]))),
    );
    const managing = await Promise.all(
      builtInRoleIds.map(async (role) => {
        const { decision } = await decide(
          requestOf({ principal: { type: 'person', id: `user_${role}` }, operation: assignARole, resource: acme }),
        );
        return [role, decision === 'allow'] as const;
      }),
    );

    expect(managing).toEqual(builtInRoleIds.map((role) => [role, builtInRoles[role].assignsRoles]));
  });

  it('let an admin alone give a role, and an admin give any of them', () => {
    expect(
      builtInRoleIds.flatMap((held) => builtInRoleIds.map((asked) => mayAssign(builtInRoles, held, asked))),
    ).toEqual([true, true, true, false, false, false, false, false, false]);
  });
});

const whatAChangePermits: ReadonlySet<Permission> = new Set([
  permissionFor('command', 'org'),
  permissionFor('command', 'playbook'),
]);

describe('a role that may start a run', () => {
  it('permits every permission a credential can hold, since a run acts on its starter’s credential, which no role cuts, as long as it runs', () => {
    const startingRuns = builtInRoleIds.filter((role) =>
      builtInRoles[role].permits.some((permission) => whatAChangePermits.has(permission)),
    );

    expect(
      startingRuns.filter(
        (role) => !allPermissions.every((permission) => builtInRoles[role].permits.includes(permission)),
      ),
    ).toEqual([]);
    expect(startingRuns).toEqual(['admin', 'editor']);
  });
});
