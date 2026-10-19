import { refusingForbiddenCharacters } from '@on.auto/definitions';
import { renderClock, type ParsedTemplate } from '@on.auto/definitions/template';
import { Conflict, InvalidInput } from '@on.auto/operations';
import { Effect, JsonPointer, Result, Schema } from 'effect';

import { interactionBounds } from './run-bounds.ts';
import { renderedText, type TextFailure } from './text-rendering.ts';

export interface RenderedPart {
  readonly template: ParsedTemplate;
  readonly pointer: string;
  readonly what: string;
  readonly mostBytes: number;
}

const inputPath = /^input\./u;

const isPartyText = Schema.is(Schema.String.check(refusingForbiddenCharacters));

export function unworkable(pointer: string, detail: string): Conflict {
  return new Conflict({ detail, kind: 'unworkable', record: { pointer } });
}

function inputPointerOf(variable: string): string {
  return inputPath.test(variable)
    ? variable
        .replace(inputPath, '')
        .split('.')
        .map((segment) => `/${JsonPointer.escapeToken(segment)}`)
        .join('')
    : '';
}

function invalidWith(detail: string, issue: string, pointer = ''): InvalidInput {
  return new InvalidInput({ detail, issues: [{ pointer, detail: issue }] });
}

export function unrenderableFor(
  what: string,
  failure: Exclude<TextFailure, { readonly reason: 'not_text' | 'too_long' }>,
): InvalidInput {
  if (failure.reason === 'missing_variable') {
    return invalidWith(
      `The definition reads ${failure.variable} on line ${failure.line}, which the input does not have`,
      `Line ${failure.line}: it reads ${failure.variable}, which this input does not have`,
      inputPointerOf(failure.variable),
    );
  }
  return invalidWith(
    `${what} cannot be rendered with this input`,
    `Line ${failure.line}: the render stopped here, past what a render may take, or at a filter that refused the value`,
  );
}

function rejectionOf({ pointer, what, mostBytes }: RenderedPart, failure: TextFailure): Conflict | InvalidInput {
  if (failure.reason === 'not_text') {
    return unworkable(
      pointer,
      `${what} renders a value that is not text on line ${failure.line}; render a field that is text, or write | json after it`,
    );
  }
  if (failure.reason === 'too_long') {
    return unworkable(pointer, `${what} renders to more than the ${mostBytes} bytes a request may hold`);
  }
  return unrenderableFor(what, failure);
}

export function renderedPart(
  part: RenderedPart,
  variables: Readonly<Record<string, Schema.Json>>,
): Effect.Effect<string, Conflict | InvalidInput> {
  return Effect.flatMap(renderClock, (clock) =>
    Result.match(renderedText(part.template, variables, part.mostBytes, clock), {
      onSuccess: Effect.succeed,
      onFailure: (failure) => Effect.fail(rejectionOf(part, failure)),
    }),
  );
}

export function checkedParty(party: string): Effect.Effect<string, Conflict> {
  if (party.trim() === '') {
    return Effect.fail(unworkable('/to', 'The party the request goes to renders to nothing'));
  }
  return isPartyText(party)
    ? Effect.succeed(party)
    : Effect.fail(
        unworkable('/to', 'The party the request goes to holds a control character, or another a party may not hold'),
      );
}

export const toPart = { pointer: '/to', what: 'The party the request goes to', mostBytes: interactionBounds.toBytes };

export const fromPart = {
  pointer: '/from',
  what: 'The party whose reply counts',
  mostBytes: interactionBounds.toBytes,
};

export function checkedAnswerer(answerer: string): Effect.Effect<string, Conflict> {
  if (answerer.trim() === '') {
    return Effect.fail(unworkable('/from', 'The party whose reply counts renders to nothing'));
  }
  return isPartyText(answerer)
    ? Effect.succeed(answerer)
    : Effect.fail(
        unworkable('/from', 'The party whose reply counts holds a control character, or another a party may not hold'),
      );
}

export const messagePart = { pointer: '', what: 'The message', mostBytes: interactionBounds.messageBytes };
