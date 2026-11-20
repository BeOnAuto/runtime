import {
  hasEnded,
  invitationEndsAt,
  pendingInvitationsIn,
  roleAssignmentDecider,
  roleAssignmentRows,
  type HeldAssignments,
  type Invitation,
  type Member,
} from '@on.auto/access-control';
import {
  AssignedRoleSchema,
  principalKeyOf,
  roleAssignmentsStreamOf,
  type AssignedPrincipal,
  type AssignedRole,
  type AssignmentScope,
} from '@on.auto/access-control/role-assignment-facts';
import type { InvitationAddress, InvitationAddresses, PeopleRows, PersonRow } from '@on.auto/openid-connect';
import { OrgReader, type ProjectedCondition, type ProjectedKeyedRow } from '@on.auto/operations';
import { DateTime, Effect, Option, Schema } from 'effect';

export interface MembersKept {
  readonly people: Pick<PeopleRows, 'listed' | 'found'>;
  readonly invitations: InvitationAddresses;
  readonly signedOut: (person: string) => Promise<void>;
  readonly publicUrl: string;
}

export type RoleId = AssignedRole['id'];

interface Profile {
  readonly id: string;
  readonly name: string | null;
  readonly identifier: string | null;
  readonly joined_at: string;
}

const rowsReadAtOnce = 100;

const HeldRowSchema = Schema.Struct({
  principal_id: Schema.String,
  role_id: AssignedRoleSchema.fields.id,
  assigned_at: Schema.String,
});

const heldRowOf = Schema.decodeUnknownSync(HeldRowSchema);

interface Held {
  readonly person: string;
  readonly role: RoleId;
  readonly assignedAt: string;
}

const heldAtTheOrg: ProjectedCondition = { column: 'scope_type', equals: 'org' };

export const aPerson = (id: string): AssignedPrincipal => ({ type: 'person', id });

export const theOrg = (id: string): AssignmentScope => ({ type: 'org', id });

export const rolesOf = (org: string) => roleAssignmentsStreamOf(theOrg(org));

function heldOf({ row }: ProjectedKeyedRow): Held {
  const held = heldRowOf(row);
  return { person: held.principal_id, role: held.role_id, assignedAt: held.assigned_at };
}

type RowsReader = Pick<OrgReader['Service'], 'readProjectedRows'>;

function heldRowsFrom(
  reader: RowsReader,
  where: readonly ProjectedCondition[],
  after?: readonly string[],
): Effect.Effect<readonly ProjectedKeyedRow[]> {
  const query = { where, orderBy: [], order: 'asc', limit: rowsReadAtOnce } as const;
  return reader.readProjectedRows(roleAssignmentRows.name, after === undefined ? query : { ...query, after }).pipe(
    Effect.flatMap((rows) => {
      const last = rows[rowsReadAtOnce - 1];
      if (last === undefined) {
        return Effect.succeed(rows);
      }
      const next = [last.key, ...Option.toArray(Option.fromNullishOr(last.child))];
      return Effect.map(heldRowsFrom(reader, where, next), (more) => [...rows, ...more]);
    }),
  );
}

const heldIn = (where: readonly ProjectedCondition[]) =>
  Effect.flatMap(OrgReader, (reader) =>
    Effect.map(heldRowsFrom(reader, where), (rows) => rows.map((row) => heldOf(row))),
  );

const isoOf = (epochMs: number) => DateTime.formatIso(DateTime.makeUnsafe(epochMs));

function profileOf({ person, name, emailAddress, joinedAt }: PersonRow): Profile {
  return { id: person, name: name ?? null, identifier: emailAddress ?? null, joined_at: isoOf(joinedAt) };
}

function unrecordedOf({ person, assignedAt }: Held): Profile {
  return { id: person, name: null, identifier: null, joined_at: assignedAt };
}

export function memberOf({ id, name, identifier, joined_at }: Profile, role: RoleId): Member {
  return { id, name, identifier, role, joined_at };
}

function earliestToJoinFirst(one: Profile, other: Profile): number {
  const byTime = one.joined_at.localeCompare(other.joined_at);
  return byTime === 0 ? one.id.localeCompare(other.id) : byTime;
}

export function membersIn({ people }: Pick<MembersKept, 'people'>): Effect.Effect<readonly Member[], never, OrgReader> {
  return Effect.gen(function* () {
    const held = yield* heldIn([heldAtTheOrg]);
    const recorded = new Map((yield* Effect.promise(() => people.listed())).map((person) => [person.person, person]));
    return held
      .map((one) => {
        const person = recorded.get(one.person);
        return memberOf(person === undefined ? unrecordedOf(one) : profileOf(person), one.role);
      })
      .toSorted((one, other) => earliestToJoinFirst(one, other));
  });
}

interface Standing {
  readonly profile: Profile;
  readonly role: RoleId | undefined;
}

export function standingOf(
  { people }: Pick<MembersKept, 'people'>,
  member: string,
): Effect.Effect<Standing | undefined, never, OrgReader> {
  return Effect.gen(function* () {
    const [held] = yield* heldIn([{ column: 'row_key', equals: principalKeyOf(aPerson(member)) }, heldAtTheOrg]);
    const recorded = yield* Effect.promise(() => people.found(member));
    if (recorded !== undefined) {
      return { profile: profileOf(recorded), role: held?.role };
    }
    return held === undefined ? undefined : { profile: unrecordedOf(held), role: held.role };
  });
}

export const rolesNowOf = (org: string): Effect.Effect<HeldAssignments, never, OrgReader> =>
  Effect.map(
    Effect.flatMap(OrgReader, (reader) => reader.load(rolesOf(org), roleAssignmentDecider)),
    ({ state }) => state,
  );

export const addressesOf = ({ invitations }: Pick<MembersKept, 'invitations'>) =>
  Effect.promise(() => invitations.listed());

export function invitationOf(
  { invitation, emailAddress, invitedAt }: InvitationAddress,
  role: RoleId,
  expiresAt: string,
): Invitation {
  return {
    id: invitation,
    email_address: emailAddress,
    role,
    status: 'pending',
    invited_at: isoOf(invitedAt),
    expires_at: expiresAt,
  };
}

export function pendingIn(
  state: HeldAssignments,
  addresses: readonly InvitationAddress[],
  at: string,
): readonly Invitation[] {
  const byInvitation = new Map(addresses.map((address) => [address.invitation, address]));
  return pendingInvitationsIn(state, at)
    .flatMap(({ invitation, role, expiresAt }) => {
      const address = byInvitation.get(invitation);
      return address === undefined ? [] : [invitationOf(address, role.id, expiresAt)];
    })
    .toSorted((one, other) => earliestInvitedFirst(one, other));
}

function earliestInvitedFirst(one: Invitation, other: Invitation): number {
  const byTime = one.invited_at.localeCompare(other.invited_at);
  return byTime === 0 ? one.id.localeCompare(other.id) : byTime;
}

export function inLowerCase(address: string): string {
  return address.replaceAll(/[A-Z]/gu, (letter) => letter.toLowerCase());
}

export function toTheAddress(addresses: readonly InvitationAddress[], emailAddress: string | null): readonly string[] {
  return emailAddress === null
    ? []
    : addresses
        .filter((address) => inLowerCase(address.emailAddress) === inLowerCase(emailAddress))
        .map(({ invitation }) => invitation);
}

function isPastItsEnd({ invitedAt }: InvitationAddress, at: string): boolean {
  return Date.parse(invitationEndsAt(isoOf(invitedAt))) <= Date.parse(at);
}

export function endedAmong(
  state: HeldAssignments,
  addresses: readonly InvitationAddress[],
  at: string,
): readonly string[] {
  return addresses
    .filter((address) => hasEnded(state, address.invitation) || isPastItsEnd(address, at))
    .map(({ invitation }) => invitation);
}
