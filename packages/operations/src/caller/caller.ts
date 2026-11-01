import { Context, Schema } from 'effect';

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

export class Caller extends Context.Service<Caller, CallerIdentity>()('@on.auto/operations/Caller') {}
