import type { PrincipalReference } from '@on.auto/operations';

import type { HeldAssignment } from './held-assignments.ts';
import type { AssignedPrincipal, AssignmentScope, AssignmentSource } from './role-assignment-facts.ts';

interface Asked {
  readonly scope: AssignmentScope;
  readonly at: string;
  readonly by: string;
}

export interface RoleGiven extends Asked, HeldAssignment {
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

export interface RolesDeprovisioned extends Asked {
  readonly kind: 'deprovision';
  readonly source: DeprovisioningSource;
  readonly principal: AssignedPrincipal;
}

export interface PersonEnrolled extends Asked {
  readonly kind: 'enrol';
  readonly principal: AssignedPrincipal;
}

export interface AdminRecovered extends Asked {
  readonly kind: 'recover';
  readonly principal: AssignedPrincipal;
}

export type RoleAssignmentCommand =
  | RoleGiven
  | RoleTaken
  | RolesProvisioned
  | RolesDeprovisioned
  | PersonEnrolled
  | AdminRecovered;
