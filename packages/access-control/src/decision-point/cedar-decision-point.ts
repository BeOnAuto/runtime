import {
  allPermissions,
  deniedFor,
  type AccessDecision,
  type AccessRequest,
  type PolicyDecisionPoint,
} from '@on.auto/operations';
import type { ShippedFiles } from '@on.auto/shipped-files';
import { Cause, Effect, Predicate } from 'effect';

import { decidedFailingClosed, messageOf } from '../engine/cedar-decisions.ts';
import { cedarCallOf, orgOfResource } from '../engine/cedar-request.ts';
import { cedarOf, type CedarModuleSource } from '../engine/cedar.ts';
import { preparedPolicies, type PreparedPolicies } from '../engine/prepared-policies.ts';
import { accessSchemaFile, builtInPoliciesFile } from '../files/access-control-files.ts';
import type { RoleAssignment, RoleAssignments } from '../roles/role-assignments.ts';
import { accessSchemaOf, type DeclaredAction } from '../schema/access-schema.ts';

export interface CedarDecisionPointParts {
  readonly module: CedarModuleSource;
  readonly files: ShippedFiles;
  readonly operations: readonly DeclaredAction[];
  readonly roles: RoleAssignments;
}

export const loadedMessage = 'The policy decision point loaded its engine and its policies';

export const unloadedMessage =
  'The policy decision point could not load its engine or its policies, so it denies every request';

export const unreadRoles = 'The roles of the principal could not be read';

async function loaded({ module, files, operations }: CedarDecisionPointParts): Promise<PreparedPolicies> {
  const [compiled, declared, policies] = await Promise.all([
    module(),
    files.text(accessSchemaFile),
    files.text(builtInPoliciesFile),
  ]);
  return preparedPolicies(cedarOf(compiled), {
    schema: accessSchemaOf(declared, allPermissions, operations),
    policies,
  });
}

function onceStarted<A>(start: () => Promise<A>): () => Promise<A> {
  let started: Promise<A> | undefined;
  return () => {
    started ??= start();
    return started;
  };
}

function decidedWith(
  { cedar, schemaName, policySetId }: PreparedPolicies,
  request: AccessRequest,
  assignments: readonly RoleAssignment[],
): AccessDecision {
  return decidedFailingClosed(() =>
    cedar.statefulIsAuthorized({
      ...cedarCallOf(request, assignments),
      preparsedSchemaName: schemaName,
      preparsedPolicySetId: policySetId,
      validateRequest: true,
    }),
  );
}

function loadedLine({ cedar, policies }: PreparedPolicies, operations: number): Effect.Effect<void> {
  return Effect.logInfo(loadedMessage).pipe(
    Effect.annotateLogs({ engine: `Cedar ${cedar.getCedarVersion()}`, policies, operations }),
  );
}

type DecidedByTheRolesRead = (request: AccessRequest) => AccessDecision;

function decidingByTheRolesOf(
  roles: RoleAssignments,
  prepared: PreparedPolicies,
  { principal, resource }: AccessRequest,
): Effect.Effect<DecidedByTheRolesRead> {
  return roles.heldBy(principal, orgOfResource(resource)).pipe(
    Effect.map(
      (assignments): DecidedByTheRolesRead =>
        (request) =>
          decidedWith(prepared, request, assignments),
    ),
    Effect.catchCauseIf(Predicate.not(Cause.hasInterruptsOnly), () =>
      Effect.succeed((): AccessDecision => deniedFor([unreadRoles])),
    ),
  );
}

function decidedAsked(
  roles: RoleAssignments,
  prepared: PreparedPolicies,
  request: AccessRequest,
): Effect.Effect<AccessDecision> {
  return Effect.map(decidingByTheRolesOf(roles, prepared, request), (decided) => decided(request));
}

function holderOf({ principal, resource }: AccessRequest): string {
  return JSON.stringify([principal.type, principal.id, orgOfResource(resource)]);
}

function decidedTogether(
  roles: RoleAssignments,
  prepared: PreparedPolicies,
  requests: readonly AccessRequest[],
): Effect.Effect<readonly AccessDecision[]> {
  return Effect.gen(function* () {
    const decidingFor = new Map<string, DecidedByTheRolesRead>();
    const decisions: AccessDecision[] = [];
    for (const request of requests) {
      const holder = holderOf(request);
      const decided = decidingFor.get(holder) ?? (yield* decidingByTheRolesOf(roles, prepared, request));
      decidingFor.set(holder, decided);
      decisions.push(decided(request));
    }
    return decisions;
  });
}

function decidingWith(roles: RoleAssignments, prepared: PreparedPolicies): PolicyDecisionPoint {
  return {
    decide: (request) => decidedAsked(roles, prepared, request),
    decideBatch: (requests) => decidedTogether(roles, prepared, requests),
  };
}

export function cedarDecisionPointLoaded(parts: CedarDecisionPointParts): Effect.Effect<PolicyDecisionPoint, string> {
  return Effect.tryPromise({ try: () => loaded(parts), catch: messageOf }).pipe(
    Effect.tap((prepared) => loadedLine(prepared, parts.operations.length)),
    Effect.map((prepared) => decidingWith(parts.roles, prepared)),
  );
}

export function cedarDecisionPoint(parts: CedarDecisionPointParts): PolicyDecisionPoint {
  const preparing = onceStarted(() => loaded(parts));
  const said = { loaded: false, unloaded: false };
  const saidUnloaded = (message: string) =>
    Effect.gen(function* () {
      if (!said.unloaded) {
        said.unloaded = true;
        yield* Effect.logError(unloadedMessage).pipe(Effect.annotateLogs({ because: message }));
      }
    });
  const saidLoaded = (prepared: PreparedPolicies) =>
    Effect.gen(function* () {
      if (!said.loaded) {
        said.loaded = true;
        yield* loadedLine(prepared, parts.operations.length);
      }
    });
  const onceLoaded = <A>(
    decided: (deciding: PolicyDecisionPoint) => Effect.Effect<A>,
    deniedUnloaded: (message: string) => A,
  ): Effect.Effect<A> =>
    Effect.tryPromise({ try: preparing, catch: messageOf }).pipe(
      Effect.matchEffect({
        onFailure: (message) => Effect.as(saidUnloaded(message), deniedUnloaded(message)),
        onSuccess: (prepared) => Effect.andThen(saidLoaded(prepared), decided(decidingWith(parts.roles, prepared))),
      }),
    );
  return {
    decide: (request) =>
      onceLoaded(
        (deciding) => deciding.decide(request),
        (message) => deniedFor([message]),
      ),
    decideBatch: (requests) =>
      onceLoaded(
        (deciding) => deciding.decideBatch(requests),
        (message) => requests.map(() => deniedFor([message])),
      ),
  };
}
