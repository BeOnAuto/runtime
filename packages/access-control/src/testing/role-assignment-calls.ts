import {
  OrgMembership,
  allPermissions,
  makeDispatcher,
  streamPrefixOfOrg,
  type CallerIdentity,
  type Outcome,
  type Runnable,
} from '@on.auto/operations';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { DateTime, Effect, Layer, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import { roleAssignmentDecider, type HeldAssignment } from '../assignments/role-assignment-decider.ts';
import { roleAssignmentsStreamOf } from '../assignments/role-assignment-facts.ts';
import { roleAssignmentRows } from '../assignments/role-assignment-rows.ts';
import type { BuiltInRoleId } from '../roles/built-in-roles.ts';

const now = '2026-11-14T16:00:00.000Z';

function aPerson(subject: string, name: string): CallerIdentity {
  return { id: `person:${subject}`, name, org: 'acme', permissions: allPermissions, playbooks: '*' };
}

export const ada = aPerson('user_ada', 'Ada Lovelace');

export const priya = aPerson('user_priya', 'Priya Shah');

export const dana = aPerson('user_dana', 'Dana Kim');

export const adasAgent: CallerIdentity = { ...ada, client: { id: 'client-7', name: 'An agent', domain: null } };

export const ciKey: CallerIdentity = { ...ada, id: 'ci-key', name: 'ci-key' };

export const localDeveloper: CallerIdentity = { ...ada, id: 'local', name: 'grace' };

export const aService: CallerIdentity = { ...ada, id: 'service:mailer', name: 'mailer' };

interface OrgOperation {
  readonly registration: Runnable<'org'>;
}

const SucceededSchema = Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Json });

export function outputOf(outcome: Outcome): Schema.Json {
  return Schema.decodeUnknownSync(SucceededSchema)(outcome).output;
}

type Membership = (org: string, person: string) => Effect.Effect<boolean>;

const everyoneIsAMember: Membership = () => Effect.succeed(true);

export function roleAssignmentCalls(isAMember: Membership = everyoneIsAMember) {
  const ledger = memoryLedger(undefined, [roleAssignmentRows]);
  const services = Layer.mergeAll(
    ledger.layer,
    memoryPlaybookRegistry([]),
    recordingReporter().layer,
    TestClock.layer(),
  );
  const dispatcher = makeDispatcher([]);
  const stream = `${streamPrefixOfOrg({ org: 'acme' })}${roleAssignmentsStreamOf({ type: 'org', id: 'acme' })}`;
  return {
    ledger,
    imported: (...held: readonly (readonly [string, BuiltInRoleId])[]) =>
      Effect.runPromise(
        ledger.service.execute(stream, roleAssignmentDecider, {
          kind: 'provision',
          source: 'import',
          scope: { type: 'org', id: 'acme' },
          assignments: held.map(([id, role]): HeldAssignment => ({
            principal: { type: 'person', id },
            role: { type: 'built_in', id: role },
          })),
          at: '2026-11-14T09:00:00.000Z',
          by: 'runtime',
        }),
      ),
    call: (operation: OrgOperation, caller: CallerIdentity, input: Readonly<Record<string, unknown>>, at = now) =>
      Effect.runPromise(
        TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(at))).pipe(
          Effect.andThen(
            dispatcher.dispatchToOrg(operation.registration, { caller, org: 'acme', input, encoding: 'json' }),
          ),
          Effect.provide(services),
          Effect.provideService(OrgMembership, isAMember),
        ),
      ),
  };
}
