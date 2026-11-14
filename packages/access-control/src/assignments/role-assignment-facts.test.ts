import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  RoleAssignmentEventSchema,
  principalKeyOf,
  roleAssignmentsStreamOf,
  type RecordedRoleAssignmentEvent,
} from './role-assignment-facts.ts';

const acted = { at: '2026-11-14T15:20:00.000Z', by: 'person:user_2ada' };

const priya = { type: 'person', id: 'user_7kLm2' } as const;

const acme = { type: 'org', id: 'acme' } as const;

const baseline: readonly RecordedRoleAssignmentEvent[] = [
  {
    type: 'role_unassigned',
    data: { principal: priya, role: { type: 'built_in', id: 'editor' }, scope: acme, source: 'manual' },
    context: acted,
  },
  {
    type: 'role_assigned',
    data: { principal: priya, role: { type: 'built_in', id: 'viewer' }, scope: acme, source: 'manual' },
    context: acted,
  },
];

describe('the facts of role assignments', () => {
  recordedFactsBehaviour({
    schema: RoleAssignmentEventSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.57.0': baseline },
  });
});

const decoded = Schema.decodeUnknownResult(RoleAssignmentEventSchema);

type Changed = Readonly<Record<string, unknown>>;

function readWith(data: Changed): boolean {
  return Result.isSuccess(
    decoded({
      type: 'role_assigned',
      data: { principal: priya, role: { type: 'built_in', id: 'viewer' }, scope: acme, source: 'import', ...data },
      context: acted,
    }),
  );
}

const read: readonly Changed[] = [
  {},
  { scope: { type: 'playbook', id: 'month-end' } },
  { source: 'invitation' },
  { source: 'enrolment' },
  { source: 'command' },
  { source: 'identity_service' },
];

const refused: readonly Changed[] = [
  { principal: { type: 'key', id: 'ci' } },
  { principal: { type: 'person', id: '' } },
  { principal: { type: 'person', id: 'u'.repeat(257) } },
  { principal: { type: 'person', id: 'user_\u0000' } },
  { role: { type: 'built_in', id: 'member' } },
  { role: { type: 'built_in', id: 'org:admin' } },
  { role: { type: 'custom', id: 'auditor' } },
  { scope: undefined },
  { scope: { type: 'org', id: 'a/b' } },
  { scope: { type: 'playbook', id: 'Month End' } },
  { scope: { type: 'definition', id: 'close' } },
  { source: 'guessed' },
];

describe('what a fact of a role assignment holds', () => {
  it('names a person by id, a built-in role by the runtime’s own id, the org or a playbook as the scope, always, and how it came about', () => {
    expect(read.map((data) => readWith(data))).toEqual(read.map(() => true));
  });

  it('refuses another kind of principal, a role the runtime does not ship, an unnamed or malformed scope, an unknown source, an empty or unbounded id, and a role written as the identity service’s key', () => {
    expect(refused.map((data) => readWith(data))).toEqual(refused.map(() => false));
  });
});

describe('the stream of a scope’s role assignments', () => {
  it('is a stream of the kind role-assignments named by a UUID of the scope’s type and id, so a playbook named org never meets the org', () => {
    const ofTheOrg = roleAssignmentsStreamOf(acme);

    expect(ofTheOrg).toMatch(
      /^role-assignments\/[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(roleAssignmentsStreamOf(acme)).toBe(ofTheOrg);
    expect(roleAssignmentsStreamOf({ type: 'org', id: 'globex' })).not.toBe(ofTheOrg);
    expect(roleAssignmentsStreamOf({ type: 'playbook', id: 'acme' })).not.toBe(ofTheOrg);
  });

  it('keys a principal by its type and id together', () => {
    expect(principalKeyOf(priya)).toBe('person:user_7kLm2');
  });
});
