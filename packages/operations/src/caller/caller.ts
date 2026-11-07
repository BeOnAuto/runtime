import { Context, Effect, Schema } from 'effect';

import { CallingClientSchema, type CallingClient } from './calling-client.ts';
import { OrgIdSchema } from './identifiers.ts';
import { PermissionSchema, type Permission } from './permission.ts';
import { PlaybookAccessSchema, type PlaybookAccess } from './playbook-access.ts';

export interface CallerIdentity {
  readonly id: string;
  readonly name: string;
  readonly org: string;
  readonly permissions: readonly Permission[];
  readonly playbooks: PlaybookAccess;
  readonly client?: CallingClient;
}

export const CallerIdentitySchema = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  org: OrgIdSchema,
  permissions: Schema.Array(PermissionSchema),
  playbooks: PlaybookAccessSchema,
  client: Schema.optionalKey(CallingClientSchema),
});

export function playbookCallerOf({
  org,
  playbook,
}: {
  readonly org: string;
  readonly playbook: string;
}): CallerIdentity {
  return {
    id: `playbook:${playbook}`,
    name: playbook,
    org,
    permissions: ['playbook:read', 'playbook:write'],
    playbooks: [playbook],
  };
}

export const signedInPersonPrefix = 'person:';

export const localDeveloperId = 'local';

function isAPerson(callerId: string): boolean {
  return callerId.startsWith(signedInPersonPrefix) || callerId === localDeveloperId;
}

type IsAMember = (org: string, person: string) => Effect.Effect<boolean>;

function everyPersonIsAMember(): Effect.Effect<boolean> {
  return Effect.succeed(true);
}

export const OrgMembership = Context.Reference<IsAMember>('@on.auto/operations/OrgMembership', {
  defaultValue: () => everyPersonIsAMember,
});

export function personOfTheOrg(org: string, callerId: string): Effect.Effect<string | undefined> {
  if (!isAPerson(callerId)) {
    return Effect.undefined;
  }
  return OrgMembership.use((isAMember) =>
    Effect.map(isAMember(org, callerId), (member) => (member ? callerId : undefined)),
  );
}

export class Caller extends Context.Service<Caller, CallerIdentity>()('@on.auto/operations/Caller') {}
