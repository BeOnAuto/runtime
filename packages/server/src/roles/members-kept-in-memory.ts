import { enrolledAtSignIn, roleAssignmentDecider, roleAssignmentRows, rolesProvisioned } from '@on.auto/access-control';
import { roleAssignmentsStreamOf } from '@on.auto/access-control/role-assignment-facts';
import type { InvitationAddress, InvitationAddresses, PersonRow } from '@on.auto/openid-connect';
import { OrgWriter, makeDispatcher, streamPrefixOfOrg, type CallerIdentity, type Runnable } from '@on.auto/operations';
import {
  memoryLedger,
  memoryPlaybookRegistry,
  recordingReporter,
  type MemoryLedger,
} from '@on.auto/operations/testing';
import { DateTime, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';

import { invitationOf } from './invitation-links.ts';
import { memberOperationsOf } from './member-operations.ts';
import type { MembersKept } from './members-read.ts';

const org = 'acme';

export const askedAt = '2026-11-19T16:00:00.000Z';

export const importedAt = '2026-11-14T09:00:00.000Z';

export const publicUrl = 'https://auto.example.test';

type Role = 'admin' | 'editor' | 'viewer';

type RoleCommand = Parameters<typeof roleAssignmentDecider.decide>[0];

interface OrgOperation {
  readonly registration: Runnable<'org'>;
}

export interface SignOuts {
  readonly signedOut: MembersKept['signedOut'];
  readonly ended: () => readonly string[];
}

export function signOutsRecorded(): SignOuts {
  const ended: string[] = [];
  return {
    signedOut: (person) => {
      ended.push(person);
      return Promise.resolve();
    },
    ended: () => [...ended],
  };
}

export function peopleKept(people: readonly PersonRow[]): MembersKept['people'] {
  return {
    listed: () => Promise.resolve(people),
    found: (person) => Promise.resolve(people.find((kept) => kept.person === person)),
  };
}

interface AddressesKept extends InvitationAddresses {
  readonly failing: () => void;
}

export function addressesKeptInMemory(): AddressesKept {
  const kept = new Map<string, InvitationAddress>();
  const forgetting = { fails: false };
  return {
    kept: (address) => {
      kept.set(address.invitation, address);
      return Promise.resolve();
    },
    listed: () => Promise.resolve([...kept.values()]),
    forgotten: (invitations) => {
      if (forgetting.fails) {
        return Promise.reject(new Error('The rows cannot be written'));
      }
      for (const invitation of invitations) {
        kept.delete(invitation);
      }
      return Promise.resolve();
    },
    failing: () => {
      forgetting.fails = true;
    },
  };
}

function writingIn(ledger: MemoryLedger) {
  const writer = OrgWriter.of({
    execute: (stream, decider, command, lineage) =>
      ledger.service.execute(`${streamPrefixOfOrg({ org })}${stream}`, decider, command, lineage),
  });
  return <A, E>(writing: Effect.Effect<A, E, OrgWriter>) =>
    Effect.runPromise(writing.pipe(Effect.provideService(OrgWriter, writer)));
}

function callingIn(ledger: MemoryLedger) {
  const services = Layer.mergeAll(
    ledger.layer,
    memoryPlaybookRegistry([]),
    recordingReporter().layer,
    TestClock.layer(),
  );
  const dispatcher = makeDispatcher([]);
  return (operation: OrgOperation, caller: CallerIdentity, input: Readonly<Record<string, unknown>>, at: string) =>
    Effect.runPromise(
      TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(at))).pipe(
        Effect.andThen(dispatcher.dispatchToOrg(operation.registration, { caller, org, input, encoding: 'json' })),
        Effect.provide(services),
      ),
    );
}

function rolesRecordedIn(written: ReturnType<typeof writingIn>) {
  const recorded = (command: RoleCommand) =>
    written(
      Effect.flatMap(OrgWriter, (writer) =>
        writer.execute(roleAssignmentsStreamOf({ type: 'org', id: org }), roleAssignmentDecider, command),
      ),
    );
  return {
    imported: (...held: readonly (readonly [string, Role])[]) =>
      written(
        rolesProvisioned(
          org,
          'import',
          held.map(([id, role]) => ({ principal: { type: 'person', id }, role: { type: 'built_in', id: role } })),
          { at: importedAt, by: 'runtime' },
        ),
      ),
    ended: (person: string, source: 'manual' | 'identity_service') =>
      recorded({
        kind: 'deprovision',
        source,
        principal: { type: 'person', id: person },
        scope: { type: 'org', id: org },
        at: importedAt,
        by: 'runtime',
      }),
    signedIn: (person: string, link?: string, at = askedAt) =>
      written(
        enrolledAtSignIn(org, person, {
          at,
          by: `person:${person}`,
          invitation: link === undefined ? undefined : invitationOf(link.slice(link.lastIndexOf('/') + 1)),
        }),
      ),
  };
}

export function membersKeptInMemory(
  people: readonly PersonRow[],
  signedOut: MembersKept['signedOut'],
  addresses: AddressesKept = addressesKeptInMemory(),
) {
  const ledger = memoryLedger(undefined, [roleAssignmentRows]);
  const call = callingIn(ledger);
  const [listMembers, inviteMember, inviteAdmin, resendInvitation, revokeInvitation, setMemberRole, removeMember] =
    memberOperationsOf({ people: peopleKept(people), invitations: addresses, signedOut, publicUrl });
  return {
    ...rolesRecordedIn(writingIn(ledger)),
    addresses,
    listed: (caller: CallerIdentity, at = askedAt) => call(listMembers, caller, {}, at),
    invited: (caller: CallerIdentity, input: Readonly<Record<string, unknown>>, at = askedAt) =>
      call(inviteMember, caller, input, at),
    invitedAnAdmin: (caller: CallerIdentity, emailAddress: string) =>
      call(inviteAdmin, caller, { email_address: emailAddress }, askedAt),
    resent: (caller: CallerIdentity, invitation: string, at = askedAt) =>
      call(resendInvitation, caller, { invitation }, at),
    revoked: (caller: CallerIdentity, invitation: string, at = askedAt) =>
      call(revokeInvitation, caller, { invitation }, at),
    roleSet: (caller: CallerIdentity, member: string, role: Role) =>
      call(setMemberRole, caller, { member, role }, askedAt),
    removed: (caller: CallerIdentity, member: string) => call(removeMember, caller, { member }, askedAt),
  };
}
