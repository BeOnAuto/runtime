import type { OperationKind, OperationScope } from '../caller/operation-scope.ts';
import type { DeclarableReason } from '../outcome/rejection.ts';
import { inputDecoder, outputEncoder } from './codecs.ts';
import { requireClosedOutput } from './definition-checks.ts';
import type { HttpBodyOf, HttpDefinition, InputSchemaFor, ObjectSchema, RelativePath } from './definition.ts';
import type { HandlerServices } from './handler-services.ts';
import { registeredFieldsOf, registeredOutputOf, runnerOf } from './registration-parts.ts';
import type { HttpRegistrationOf } from './registration.ts';
import type { MethodOf } from './route.ts';

export interface HttpOperation<S extends OperationScope, K extends OperationKind> {
  readonly registration: HttpRegistrationOf<S, K>;
}

export function defineHttpOperation<
  const S extends OperationScope,
  const K extends OperationKind,
  const M extends MethodOf<K>,
  const P extends RelativePath,
  const B extends HttpBodyOf<K, M>,
  In extends InputSchemaFor<S, P>,
  Out extends ObjectSchema,
  const R extends DeclarableReason = never,
  Services extends HandlerServices<S, K> = never,
>(scope: S, kind: K, definition: HttpDefinition<K, M, P, B, In, Out, R, Services>): HttpOperation<S, K> {
  const { name, body, inputSchema, outputSchema, handle } = definition;
  const fields = registeredFieldsOf(scope, kind, definition);
  requireClosedOutput(name, outputSchema);
  const run = runnerOf(inputDecoder(inputSchema), handle, outputEncoder(outputSchema), fields.reasons);
  return {
    registration: { ...fields, servedOverHttpAlone: body, output: registeredOutputOf(outputSchema), run },
  };
}
