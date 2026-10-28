import { Effect, Result } from 'effect';

import type { OperationKind, OperationScope } from '../caller/operation-scope.ts';
import { Conflict, resolutionOf } from '../outcome/conflict.ts';
import { rejected, type Rejected, type Succeeded } from '../outcome/outcome.ts';
import type { DeclarableReason, Rejection } from '../outcome/rejection.ts';
import { checkedDefinition } from './definition-checks.ts';
import type { Definition, JsonAnswer, ObjectSchema, StreamAnswer } from './definition.ts';
import { refusesEmptyBody } from './encoded-shape.ts';
import { jsonSchemaDocumentOf, type JsonSchemaDocument } from './json-schema.ts';
import type { RegisteredAnswer, RegisteredFieldsOf } from './registration.ts';

export function settledOf<Answer, S extends Succeeded, R extends DeclarableReason, Services>(
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
    const described: Rejected = {
      ...rejected(reason, detail, issues, kind),
      ...(because === undefined ? {} : { because }),
      ...(rejection instanceof Conflict ? resolutionOf(rejection) : {}),
    };
    return yield* reasons.includes(reason) ? Effect.fail(described) : Effect.die(rejection);
  });
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
  | 'irreversible'
  | 'repeatable'
  | 'permittedBy'
  | 'inputSchema'
  | 'reasons'
> &
  Partial<Pick<Definition<K, string, ObjectSchema, ObjectSchema, DeclarableReason, unknown>, 'outputSchema'>>;

type RegisteredFields<S extends OperationScope, K extends OperationKind> = Omit<
  RegisteredFieldsOf<S, K>,
  'plainLanguage'
>;

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
    irreversible: definition.irreversible ?? false,
    repeatable: definition.repeatable ?? false,
    permissions,
    reasons: [...new Set(definition.reasons)],
    input: jsonSchemaDocumentOf(definition.inputSchema),
    refusesEmptyBody: refusesEmptyBody(definition.inputSchema, pathParameters),
  };
}

export function registeredOutputOf(outputSchema: ObjectSchema): JsonSchemaDocument {
  return jsonSchemaDocumentOf(outputSchema);
}

export function registeredAnswerOf(answer: JsonAnswer<ObjectSchema> | StreamAnswer): RegisteredAnswer {
  return answer.kind === 'json'
    ? { kind: 'json', output: registeredOutputOf(answer.outputSchema) }
    : { kind: 'stream', mediaType: answer.mediaType };
}
