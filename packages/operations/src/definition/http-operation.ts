import { Effect } from 'effect';

import type { OperationKind, OperationScope } from '../caller/operation-scope.ts';
import type { DeclarableReason } from '../outcome/rejection.ts';
import { inputDecoder } from './codecs.ts';
import type {
  AnswerDeclarations,
  AnswerKind,
  AnswerValues,
  HttpBodyOf,
  HttpDefinition,
  HttpFields,
  HttpHandlerOf,
  InputSchemaFor,
  ObjectSchema,
  OfOneAnswerKind,
  RelativePath,
} from './definition.ts';
import type { HandlerServices } from './handler-services.ts';
import { answeringOf, bodyArgumentsFor, requireMostBytes } from './http-body.ts';
import { registeredAnswerOf, registeredFieldsOf, settledOf } from './registration-parts.ts';
import type { HttpRegistrationOf } from './registration.ts';
import type { MethodOf } from './route.ts';

export interface HttpOperation<S extends OperationScope, K extends OperationKind> {
  readonly registration: HttpRegistrationOf<S, K>;
}

type AnsweringDefinition<
  K extends OperationKind,
  M extends MethodOf<K>,
  P extends string,
  B extends HttpBodyOf<K, M>,
  A extends AnswerKind,
  In extends ObjectSchema,
  Out extends ObjectSchema,
  R extends DeclarableReason,
  Services,
> = {
  readonly [Kind in A]: HttpFields<K, M, P, B, In, R> &
    HttpHandlerOf<In, B, AnswerValues<Out>[Kind], R, Services> & {
      readonly answer: AnswerDeclarations<Out>[Kind] & { readonly kind: Kind };
    };
}[A];

export function defineHttpOperation<
  const S extends OperationScope,
  const K extends OperationKind,
  const M extends MethodOf<K>,
  const P extends RelativePath,
  const B extends HttpBodyOf<K, M>,
  const A extends AnswerKind,
  In extends InputSchemaFor<S, P>,
  Out extends ObjectSchema,
  const R extends DeclarableReason = never,
  Services extends HandlerServices<S, K> = never,
>(
  scope: S,
  kind: K,
  definition: HttpDefinition<K, M, P, B, A, In, Out, R, Services> & OfOneAnswerKind<A>,
): HttpOperation<S, K>;
export function defineHttpOperation<
  S extends OperationScope,
  K extends OperationKind,
  M extends MethodOf<K>,
  P extends RelativePath,
  B extends HttpBodyOf<K, M>,
  A extends AnswerKind,
  In extends InputSchemaFor<S, P>,
  Out extends ObjectSchema,
  R extends DeclarableReason,
  Services extends HandlerServices<S, K>,
>(scope: S, kind: K, definition: AnsweringDefinition<K, M, P, B, A, In, Out, R, Services>): HttpOperation<S, K> {
  const { name, body, inputSchema, handle } = definition;
  const fields = registeredFieldsOf(scope, kind, definition);
  requireMostBytes(name, body);
  const decodeInput = inputDecoder(inputSchema);
  const answer: A = definition.answer.kind;
  const answered = answeringOf<Out>(name)[answer](definition.answer);
  const run: HttpRegistrationOf<S, K>['run'] = (input, encoding, given) =>
    Effect.flatMap(decodeInput(input, encoding), (decoded) =>
      Effect.flatMap(bodyArgumentsFor(body.kind, name, given), (bodyArguments) =>
        settledOf(handle(decoded, ...bodyArguments), answered, fields.reasons),
      ),
    );
  return { registration: { ...fields, servedOverHttpAlone: body, answer: registeredAnswerOf(definition.answer), run } };
}
