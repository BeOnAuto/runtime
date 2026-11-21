import type { Effect } from 'effect';

import type { OperationKind, OperationScope } from '../caller/operation-scope.ts';
import type { Permission } from '../caller/permission.ts';
import type { PlaybookAccess } from '../caller/playbook-access.ts';

type PrincipalType = 'person' | 'key' | 'playbook' | 'local_developer';

export interface PrincipalReference {
  readonly type: PrincipalType;
  readonly id: string;
}

export type ResourceReference =
  | { readonly type: 'org'; readonly id: string }
  | { readonly type: 'playbook'; readonly id: string; readonly org: string }
  | { readonly type: 'definition'; readonly id: string; readonly playbook: string; readonly org: string };

export interface ActionReference {
  readonly scope: OperationScope;
  readonly name: string;
}

export type ArrivedVia = 'studio' | 'agent' | 'key' | 'conversation' | 'run' | 'local';

interface AccessGrant {
  readonly org: string;
  readonly permissions: readonly Permission[];
  readonly playbooks: PlaybookAccess;
}

interface DeclaredOperation {
  readonly kind: OperationKind;
  readonly targetsPlaybook: boolean;
  readonly readsOnly: boolean;
  readonly reachesOutside: boolean;
  readonly mayChangeOutside: boolean;
  readonly irreversible: boolean;
  readonly permissionsManagement: boolean;
  readonly enrolment: boolean;
}

export interface AccessContext {
  readonly via: ArrivedVia;
  readonly granted: AccessGrant;
  readonly operation: DeclaredOperation;
}

export interface AccessRequest {
  readonly principal: PrincipalReference;
  readonly action: ActionReference;
  readonly resource: ResourceReference;
  readonly context: AccessContext;
}

export interface AccessDecision {
  readonly decision: 'allow' | 'deny';
  readonly determiningPolicies: readonly string[];
  readonly errors: readonly string[];
}

export interface PolicyDecisionPoint {
  readonly decide: (request: AccessRequest) => Effect.Effect<AccessDecision>;
  readonly decideBatch: (requests: readonly AccessRequest[]) => Effect.Effect<readonly AccessDecision[]>;
}

export function deniedFor(errors: readonly string[]): AccessDecision {
  return { decision: 'deny', determiningPolicies: [], errors };
}
