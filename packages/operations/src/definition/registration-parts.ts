import { Effect, Result, type Schema } from 'effect';

import type { OperationKind, OperationScope } from '../caller/operation-scope.ts';
import { resolutionIn } from '../outcome/conflict.ts';
import { cappedOptions, rejected, succeeded, type Rejected, type Succeeded } from '../outcome/outcome.ts';
import type { DeclarableReason, Rejection } from '../outcome/rejection.ts';
import { checkedDefinition } from './definition-checks.ts';
import type { Definition, ObjectSchema } from './definition.ts';
import { refusesEmptyBody } from './encoded-shape.ts';
import { jsonSchemaDocumentOf, type JsonSchemaDocument } from './json-schema.ts';
import type { RegisteredFieldsOf } from './registration.ts';

function settledOf<Answer, S extends Succeeded, R extends DeclarableReason, Services>(
  handled: Effect.Effect<Answer, Rejection<R>, Services>,
  succeededWith: (answer: Answer) => Effect.Effect<S>,
  reasons: readonly DeclarableReason[],
): Effect.Effect<S, Rejected, Services> {
  return Effect.gen(function* () {
    const result = yield* Effect.result(handled);
    if (Result.isSuccess(result)) {
      return yield* succeededWith(result.success);
    }
    const rejection = result.failure;
    const { _tag: reason, detail } = rejection;
    const issues = 'issues' in rejection ? rejection.issues : undefined;
    const kind = 'kind' in rejection ? rejection.kind : undefined;
    const because = 'because' in rejection ? rejection.because : undefined;
    const options = 'options' in rejection ? rejection.options : undefined;
    const described: Rejected = {
      ...rejected(reason, detail, issues, kind),
      ...(because === undefined ? {} : { because }),
      ...(options === undefined ? {} : { options: cappedOptions(options) }),
      ...resolutionIn(rejection),
    };
    return yield* reasons.includes(reason) ? Effect.fail(described) : Effect.die(rejection);
  });
}

export function runnerOf<Input, Output, Encoding, R extends DeclarableReason, Services>(
  decodeInput: (input: unknown, encoding: Encoding) => Effect.Effect<Input, Rejected>,
  handle: (input: Input) => Effect.Effect<Output, Rejection<R>, Services>,
  encodeOutput: (output: Output) => Effect.Effect<Schema.JsonObject>,
  reasons: readonly DeclarableReason[],
): (input: unknown, encoding: Encoding) => Effect.Effect<Succeeded, Rejected, Services> {
  return (input, encoding) =>
    Effect.flatMap(decodeInput(input, encoding), (decoded) =>
      settledOf(handle(decoded), (output) => Effect.map(encodeOutput(output), succeeded), reasons),
    );
}

type RegisteredDefinition<K extends OperationKind> = Pick<
  Definition<K, string, ObjectSchema, ObjectSchema, DeclarableReason, unknown>,
  | 'name'
  | 'title'
  | 'description'
  | 'route'
  | 'successStatus'
  | 'reachesOutside'
  | 'mayChangeOutside'
  | 'readsOnly'
  | 'irreversible'
  | 'permissionsManagement'
  | 'enrolment'
  | 'connectionsManagement'
  | 'repeatable'
  | 'whileRetired'
  | 'permittedBy'
  | 'staleOn'
  | 'inputSchema'
  | 'reasons'
> &
  Partial<Pick<Definition<K, string, ObjectSchema, ObjectSchema, DeclarableReason, unknown>, 'outputSchema'>> & {
    readonly sameInEveryScope?: boolean;
  };

type RegisteredFields<S extends OperationScope, K extends OperationKind> = Omit<
  RegisteredFieldsOf<S, K>,
  'plainLanguage'
>;

function declaredWhereSo({
  enrolment,
  connectionsManagement,
}: Pick<RegisteredDefinition<OperationKind>, 'enrolment' | 'connectionsManagement'>): Pick<
  RegisteredFields<OperationScope, OperationKind>,
  'enrolment' | 'connectionsManagement'
> {
  return {
    ...(enrolment === true ? { enrolment: true } : {}),
    ...(connectionsManagement === true ? { connectionsManagement: true } : {}),
  };
}

function sameInEveryScopeWhereDeclared({
  sameInEveryScope,
}: Pick<RegisteredDefinition<OperationKind>, 'sameInEveryScope'>): Pick<
  RegisteredFields<OperationScope, OperationKind>,
  'sameInEveryScope'
> {
  return sameInEveryScope === true ? { sameInEveryScope: true } : {};
}

export function registeredFieldsOf<S extends OperationScope, K extends OperationKind>(
  scope: S,
  kind: K,
  definition: RegisteredDefinition<K>,
): RegisteredFields<S, K> {
  const { pathParameters, targetsPlaybook, permissions } = checkedDefinition(scope, kind, definition);
  return {
    scope,
    kind,
    name: definition.name,
    title: definition.title,
    description: definition.description,
    route: definition.route,
    pathParameters,
    targetsPlaybook,
    successStatus: definition.successStatus ?? 200,
    reachesOutside: definition.reachesOutside ?? false,
    mayChangeOutside: definition.mayChangeOutside ?? false,
    readsOnly: definition.readsOnly ?? false,
    irreversible: definition.irreversible ?? false,
    permissionsManagement: definition.permissionsManagement ?? false,
    ...declaredWhereSo(definition),
    repeatable: definition.repeatable ?? false,
    ...(definition.whileRetired === true ? { whileRetired: true } : {}),
    ...sameInEveryScopeWhereDeclared(definition),
    permissions,
    ...(definition.staleOn === undefined ? {} : { staleOn: definition.staleOn }),
    reasons: [...new Set(definition.reasons)],
    input: jsonSchemaDocumentOf(definition.inputSchema),
    refusesEmptyBody: refusesEmptyBody(definition.inputSchema, pathParameters),
  };
}

export function registeredOutputOf(outputSchema: ObjectSchema): JsonSchemaDocument {
  return jsonSchemaDocumentOf(outputSchema);
}
