import { allPermissions, makeDispatcher, type CallerIdentity, type Permission } from '@on.auto/operations';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { Effect, Layer, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { CallerRoles } from '../roles/caller-roles.ts';
import type { RoleAssignment, RoleAssignments } from '../roles/role-assignments.ts';
import { builtIn, rolesHeld } from '../testing/access-testing.ts';
import { ada, adasAgent, ciKey, localDeveloper, outputOf } from '../testing/role-assignment-calls.ts';
import { getCaller } from './get-caller.ts';

const acme: RoleAssignment['scope'] = { type: 'org', id: 'acme' };

const AnsweredSchema = Schema.Struct({ permissions: Schema.Array(Schema.String) });

const services = Layer.mergeAll(memoryLedger().layer, memoryPlaybookRegistry([]), recordingReporter().layer);

function answeredTo(caller: CallerIdentity, roles?: RoleAssignments): Promise<readonly string[]> {
  const asked = makeDispatcher([]).dispatchToOrg(getCaller.registration, {
    caller,
    org: 'acme',
    input: {},
    encoding: 'json',
  });
  const withTheRoles = roles === undefined ? asked : Effect.provideService(asked, CallerRoles, roles);
  return Effect.runPromise(withTheRoles.pipe(Effect.provide(services))).then(
    (outcome) => Schema.decodeUnknownSync(AnsweredSchema)(outputOf(outcome)).permissions,
  );
}

const holding = (role: string, scope: RoleAssignment['scope'] = acme) =>
  rolesHeld({ user_ada: [builtIn(role, scope)] });

const reading: readonly Permission[] = ['org:read', 'playbook:read'];

const running: readonly Permission[] = ['org:read', 'playbook:read', 'playbook:run'];

const theFourASignInAsksFor: readonly Permission[] = ['org:read', 'org:write', 'playbook:read', 'playbook:write'];

describe('get_caller', () => {
  it('is a query of the org at GET /caller, over HTTP alone, for a credential that may read the org or a playbook', () => {
    expect(getCaller.registration).toMatchObject({
      scope: 'org',
      kind: 'query',
      name: 'get_caller',
      route: { method: 'GET', path: '/caller' },
      servedOverHttpAlone: { kind: 'none' },
      permissions: ['org:read', 'playbook:read'],
      permissionsManagement: false,
    });
  });

  it('answers a person the permissions of their credential that their role in the org permits', async () => {
    expect([
      await answeredTo(ada, holding('admin')),
      await answeredTo(ada, holding('editor')),
      await answeredTo(ada, holding('operator')),
      await answeredTo(ada, holding('viewer')),
    ]).toEqual([allPermissions, allPermissions, running, reading]);
  });

  it('answers no more than the credential holds, however much the role permits, in the order of the permissions', async () => {
    const readingAlone = { ...adasAgent, permissions: ['playbook:read', 'org:read'] } satisfies CallerIdentity;

    expect(await answeredTo(readingAlone, holding('admin'))).toEqual(reading);
  });

  it('answers a person who holds no role in the org nothing, a role of another org, or one no release ships, among them', async () => {
    expect([
      await answeredTo(ada, rolesHeld({})),
      await answeredTo(ada, holding('admin', { type: 'org', id: 'globex' })),
      await answeredTo(ada, holding('admin', { type: 'playbook', id: 'sales' })),
      await answeredTo(ada, holding('owner')),
    ]).toEqual([[], [], [], []]);
  });

  it('answers a key and the local developer by their credential alone, which no role bounds', async () => {
    const readOnlyKey = { ...ciKey, permissions: reading } satisfies CallerIdentity;

    expect([await answeredTo(readOnlyKey, holding('admin')), await answeredTo(localDeveloper, rolesHeld({}))]).toEqual([
      reading,
      allPermissions,
    ]);
  });

  it('answers by the credential alone where no decision point reads the roles of the call', async () => {
    expect(await answeredTo(ada)).toEqual(allPermissions);
  });
});

describe('get_caller, for a credential that holds the permission to change playbooks', () => {
  it('answers it the permission to run them too, which the first includes', async () => {
    const signedInWithTheFour = { ...adasAgent, permissions: theFourASignInAsksFor } satisfies CallerIdentity;

    expect([
      await answeredTo(signedInWithTheFour, holding('editor')),
      await answeredTo(signedInWithTheFour, holding('operator')),
      await answeredTo(signedInWithTheFour, holding('viewer')),
    ]).toEqual([allPermissions, running, reading]);
  });
});
