import type { Conflict, InsideReading, InvalidInput } from '@on.auto/operations';
import { Effect, Result, type Schema } from 'effect';

import { inputReadBy, unreadAssetOf } from '../template/inside-reads.ts';
import { renderClock } from '../template/render-clock.ts';
import type { CallBlock } from './call-block-schemas.ts';
import { unrenderableFor, unworkable } from './render-refusals.ts';
import {
  argumentsFailureWords,
  momentVariables,
  renderedArgumentsOf,
  smallerInputRemedy,
  variablesReadInside,
  type ArgumentsFailure,
} from './rendered-arguments.ts';

function argumentsRejection(failure: ArgumentsFailure): Conflict | InvalidInput {
  if (failure.reason === 'too_large') {
    return unworkable('/call/with', argumentsFailureWords(failure, 'the call', smallerInputRemedy));
  }
  const { argument, failure: rendering } = failure;
  return rendering.reason === 'not_text' || rendering.reason === 'too_long'
    ? unworkable(`/call/with/${argument}`, argumentsFailureWords(failure, 'the call', smallerInputRemedy))
    : unrenderableFor(`The argument ${argument} of the call`, rendering);
}

export function callArgumentsOf(
  call: CallBlock,
  input: Schema.Json,
  at: string,
  reading: InsideReading,
): Effect.Effect<Readonly<Record<string, Schema.Json>>, Conflict | InvalidInput> {
  const templates = call.with ?? {};
  return Effect.gen(function* () {
    const read = yield* Effect.mapError(inputReadBy(variablesReadInside(templates), input, reading), unreadAssetOf);
    const rendering = {
      variables: momentVariables(input, at),
      textVariables: momentVariables(read, at),
      clock: yield* renderClock,
      mostBytes: reading.bound.most,
    };
    return yield* Result.match(renderedArgumentsOf(templates, rendering), {
      onSuccess: ({ input: rendered }) => Effect.succeed(rendered),
      onFailure: (failure) => Effect.fail(argumentsRejection(failure)),
    });
  });
}
