import { Effect } from 'effect';

import type { OperationKind, OperationScope } from '../caller/operation-scope.ts';
import type { DeclarableReason, Rejection } from '../outcome/rejection.ts';
import { inputDecoder, linkFields, outputEncoder, plainLanguageFields, typeValidator } from './codecs.ts';
import type { Definition, InputSchemaFor, ObjectSchema, RelativePath } from './definition.ts';
import type { HandlerServices } from './handler-services.ts';
import { registeredFieldsOf, registeredOutputOf, runnerOf } from './registration-parts.ts';
import type { RegistrationOf } from './registration.ts';

export interface Operation<
  S extends OperationScope,
  K extends OperationKind,
  Input,
  Output,
  R extends DeclarableReason,
  Services,
> {
  readonly registration: RegistrationOf<S, K>;
  readonly call: (input: Input) => Effect.Effect<Output, Rejection<R>, Services>;
}

export function defineQuery<
  const S extends OperationScope,
  const P extends RelativePath,
  In extends InputSchemaFor<S, P>,
  Out extends ObjectSchema,
  const R extends DeclarableReason = never,
  Services extends HandlerServices<S, 'query'> = never,
  ReadServices extends HandlerServices<S, 'query'> = never,
>(
  scope: S,
  definition: Definition<'query', P, In, Out, R, Services, ReadServices>,
): Operation<S, 'query', In['Type'], Out['Type'], R, Services> {
  return defineOperation(scope, 'query', definition);
}

export function defineCommand<
  const S extends OperationScope,
  const P extends RelativePath,
  In extends InputSchemaFor<S, P>,
  Out extends ObjectSchema,
  const R extends DeclarableReason = never,
  Services extends HandlerServices<S, 'command'> = never,
  ReadServices extends HandlerServices<S, 'command'> = never,
>(
  scope: S,
  definition: Definition<'command', P, In, Out, R, Services, ReadServices>,
): Operation<S, 'command', In['Type'], Out['Type'], R, Services> {
  return defineOperation(scope, 'command', definition);
}

function defineOperation<
  S extends OperationScope,
  K extends OperationKind,
  In extends ObjectSchema,
  Out extends ObjectSchema,
  R extends DeclarableReason,
  Services extends HandlerServices<S, K>,
  ReadServices extends HandlerServices<S, K>,
>(
  scope: S,
  kind: K,
  definition: Definition<K, string, In, Out, R, Services, ReadServices>,
): Operation<S, K, In['Type'], Out['Type'], R, Services> {
  const { inputSchema, outputSchema, handle } = definition;
  const fields = registeredFieldsOf(scope, kind, definition);
  const decodeInput = inputDecoder(inputSchema);
  const encodeOutput = outputEncoder(outputSchema);
  const validateInput = typeValidator(inputSchema);
  const validateOutput = typeValidator(outputSchema);
  const runOf = (answer: (input: In['Type']) => Effect.Effect<Out['Type'], Rejection<R>, Services | ReadServices>) =>
    runnerOf(decodeInput, answer, encodeOutput, fields.reasons);
  const registration = {
    ...fields,
    output: registeredOutputOf(outputSchema),
    ...plainLanguageFields(definition.plainLanguage, inputSchema, outputSchema),
    run: runOf(handle),
  };
  return {
    registration: {
      ...registration,
      ...linkFields(definition, outputSchema, (read) => ({ ...registration, run: runOf(read) })),
    },
    call: (input) => validateInput(input).pipe(Effect.flatMap(handle), Effect.tap(validateOutput)),
  };
}
