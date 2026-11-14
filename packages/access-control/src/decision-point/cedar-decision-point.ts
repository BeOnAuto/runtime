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

export function cedarDecisionPoint(parts: CedarDecisionPointParts): PolicyDecisionPoint {
  const preparing = onceStarted(() => loaded(parts));
  const said = { loaded: false, unloaded: false };
  const deniedUnloaded = (message: string) =>
    Effect.gen(function* () {
      if (!said.unloaded) {
        said.unloaded = true;
        yield* Effect.logError(unloadedMessage).pipe(Effect.annotateLogs({ because: message }));
      }
      return deniedFor([message]);
    });
  const decidedAsked = (prepared: PreparedPolicies, request: AccessRequest) =>
    parts.roles.heldBy(request.principal, orgOfResource(request.resource)).pipe(
      Effect.map((assignments) => decidedWith(prepared, request, assignments)),
      Effect.catchCauseIf(Predicate.not(Cause.hasInterruptsOnly), () => Effect.succeed(deniedFor([unreadRoles]))),
    );
  const decidedOnce = (prepared: PreparedPolicies, request: AccessRequest) =>
    Effect.gen(function* () {
      if (!said.loaded) {
        said.loaded = true;
        yield* loadedLine(prepared, parts.operations.length);
      }
      return yield* decidedAsked(prepared, request);
    });
  return {
    decide: (request) =>
      Effect.tryPromise({ try: preparing, catch: messageOf }).pipe(
        Effect.matchEffect({
          onFailure: deniedUnloaded,
          onSuccess: (prepared) => decidedOnce(prepared, request),
        }),
      ),
  };
}
