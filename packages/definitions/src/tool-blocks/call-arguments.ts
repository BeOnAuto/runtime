import type { Conflict, InvalidInput } from '@on.auto/operations';
import { Effect, Result, type Schema } from 'effect';

import { renderClock } from '../template/render-clock.ts';
import type { CallBlock } from './call-block-schemas.ts';
import { unrenderableFor, unworkable } from './render-refusals.ts';
import {
  argumentsFailureWords,
  renderedArguments,
  type ArgumentsFailure,
  type TemplateVariables,
} from './rendered-arguments.ts';

function argumentsRejection(failure: ArgumentsFailure): Conflict | InvalidInput {
  if (failure.reason === 'too_large') {
    return unworkable('/call/with', argumentsFailureWords(failure, 'the call'));
  }
  const { argument, failure: rendering } = failure;
  return rendering.reason === 'not_text' || rendering.reason === 'too_long'
    ? unworkable(`/call/with/${argument}`, argumentsFailureWords(failure, 'the call'))
    : unrenderableFor(`The argument ${argument} of the call`, rendering);
}

export function callArgumentsOf(
  call: CallBlock,
  variables: TemplateVariables,
): Effect.Effect<Readonly<Record<string, Schema.Json>>, Conflict | InvalidInput> {
  return Effect.flatMap(renderClock, (clock) =>
    Result.match(renderedArguments(call.with ?? {}, variables, clock), {
      onSuccess: ({ input }) => Effect.succeed(input),
      onFailure: (failure) => Effect.fail(argumentsRejection(failure)),
    }),
  );
}
