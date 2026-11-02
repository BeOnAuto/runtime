import { outputText, renderedTemplate, type RenderClock, type RenderFailure } from '@on.auto/definitions/template';
import { Conflict, InvalidInput } from '@on.auto/operations';
import { Effect, Result, type Schema } from 'effect';
import { toValue, type Emitter } from 'liquidjs';

import type { WrittenText } from '../document/memory-document.ts';
import { memoryEngine } from '../document/written-fields.ts';

export interface Rendering {
  readonly variables: Readonly<Record<string, Schema.Json>>;
  readonly clock: RenderClock;
}

function noRefusal(): undefined {
  return undefined;
}

function failureInWords(failure: RenderFailure): string {
  if (failure.reason === 'missing_variable') {
    return `the template reads ${failure.variable}, which this input does not have`;
  }
  return failure.reason === 'limit_exceeded'
    ? `the render takes more ${failure.limit} than a render may`
    : failure.detail;
}

export function renderedText(
  written: WrittenText,
  { variables, clock }: Rendering,
): Effect.Effect<string, InvalidInput> {
  let text = '';
  const emitter: Emitter = {
    buffer: '',
    write(html: unknown) {
      text += outputText(toValue(html));
    },
  };
  return Result.match(
    renderedTemplate<never>(memoryEngine, written.template, { variables, emitter, refusalOf: noRefusal, clock }),
    {
      onSuccess: () => Effect.succeed(text),
      onFailure: (failure) =>
        Effect.fail(
          new InvalidInput({
            detail: 'The memory function cannot render its templates with this input',
            issues: [{ pointer: '', detail: `Line ${failure.line}, ${written.pointer}: ${failureInWords(failure)}` }],
          }),
        ),
    },
  );
}

export function checkedRendered(
  rendered: string,
  { pointer }: WrittenText,
  problem: (text: string) => string | undefined,
): Effect.Effect<string, Conflict> {
  const found = problem(rendered);
  return found === undefined
    ? Effect.succeed(rendered)
    : Effect.fail(new Conflict({ detail: found, kind: 'unworkable', record: { pointer } }));
}

export function renderedAndChecked(
  written: WrittenText,
  rendering: Rendering,
  problem: (text: string) => string | undefined,
): Effect.Effect<string, InvalidInput | Conflict> {
  return Effect.flatMap(renderedText(written, rendering), (rendered) => checkedRendered(rendered, written, problem));
}
