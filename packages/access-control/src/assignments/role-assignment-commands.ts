import type { PrincipalReference, Rejection } from '@on.auto/operations';
import type { Result } from 'effect';

import type { HeldAssignment } from './held-assignments.ts';
import type {
  AssignedPrincipal,
  AssignedRole,
  AssignmentScope,
  AssignmentSource,
  DefaultRole,
  Enrolment,
  RoleAssignmentEvent,
} from './role-assignment-facts.ts';

interface Asked {
  readonly scope: AssignmentScope;
  readonly at: string;
  readonly by: string;
}

interface RevokingTheirInvitations {
  readonly invitations?: readonly string[];
}

export interface RoleGiven extends Asked, HeldAssignment, RevokingTheirInvitations {
  readonly kind: 'assign';
  readonly actor: PrincipalReference;
}

export interface RoleTaken extends Asked, HeldAssignment {
  readonly kind: 'unassign';
  readonly actor: PrincipalReference;
}

export type ProvisioningSource = Exclude<AssignmentSource, 'manual' | 'bootstrap'>;

export interface RolesProvisioned extends Asked {
  readonly kind: 'provision';
  readonly source: ProvisioningSource;
  readonly assignments: readonly HeldAssignment[];
}

export type DeprovisioningSource = Extract<AssignmentSource, 'manual' | 'identity_service'>;

export interface RolesDeprovisioned extends Asked, RevokingTheirInvitations {
  readonly kind: 'deprovision';
  readonly source: DeprovisioningSource;
  readonly principal: AssignedPrincipal;
}

export interface PersonEnrolled extends Asked {
  readonly kind: 'enrol';
  readonly principal: AssignedPrincipal;
  readonly invitation?: string | undefined;
}

export interface AdminRecovered extends Asked {
  readonly kind: 'recover';
  readonly principal: AssignedPrincipal;
}

export interface MemberInvited extends Asked {
  readonly kind: 'invite';
  readonly inviter: AssignedPrincipal;
  readonly invitation: string;
  readonly role: AssignedRole;
}

export interface InvitationRevoked extends Asked {
  readonly kind: 'revoke';
  readonly invitation: string;
}

export interface InvitationResent extends Asked {
  readonly kind: 'resend';
  readonly invitation: string;
  readonly replacement: string;
}

export interface EnrolmentSet extends Asked {
  readonly kind: 'set_enrolment';
  readonly actor: PrincipalReference;
  readonly enrolment: Enrolment;
  readonly role?: DefaultRole | undefined;
}

export type RoleAssignmentCommand =
  | RoleGiven
  | RoleTaken
  | RolesProvisioned
  | RolesDeprovisioned
  | PersonEnrolled
  | AdminRecovered
  | MemberInvited
  | InvitationRevoked
  | InvitationResent
  | EnrolmentSet;

export type RoleAssignmentRefusal = 'forbidden' | 'conflict';

export type Decision = Result.Result<readonly RoleAssignmentEvent[], Rejection<RoleAssignmentRefusal>>;
