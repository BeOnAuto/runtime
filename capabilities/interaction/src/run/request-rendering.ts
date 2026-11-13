import { Buffer } from 'node:buffer';

import { refusingForbiddenCharacters } from '@on.auto/definitions';
import { renderClock, type ParsedTemplate } from '@on.auto/definitions/template';
import { renderedText, unrenderableFor, unworkable, type TextFailure } from '@on.auto/definitions/tool-blocks';
import { InvalidInput, type Conflict } from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';

import type { RenderedBody } from '../document/interaction-document.ts';
import { renderedCard } from '../rendering/card-rendering.ts';
import type { RenderState } from '../rendering/rendered-message.ts';
import { interactionBounds } from './run-bounds.ts';

export interface RenderedPart {
  readonly template: ParsedTemplate;
  readonly pointer: string;
  readonly what: string;
  readonly mostBytes: number;
}

const isPartyText = Schema.is(Schema.String.check(refusingForbiddenCharacters));

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

export interface RenderedRequest {
  readonly message: string;
  readonly rendered: Schema.Json;
}

function unrenderable(issues: readonly string[]): InvalidInput {
  return new InvalidInput({
    detail: 'The message cannot be rendered with this input',
    issues: issues.map((detail) => ({ pointer: '', detail })),
  });
}

export function renderedRequest(
  { target, card }: RenderedBody,
  state: RenderState,
): Effect.Effect<RenderedRequest, Conflict | InvalidInput> {
  return Result.match(renderedCard(target, card, state), {
    onSuccess: ({ payload, text }) => {
      if (Buffer.byteLength(text, 'utf8') > interactionBounds.messageBytes) {
        return Effect.fail(
          unworkable(
            '',
            `${messagePart.what} renders to more than the ${messagePart.mostBytes} bytes a request may hold`,
          ),
        );
      }
      const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
      return bytes > interactionBounds.renderedBytes
        ? Effect.fail(
            unworkable(
              '',
              `The rendered message takes ${bytes} bytes, more than the ${interactionBounds.renderedBytes} a request may hold; show less of the input`,
            ),
          )
        : Effect.succeed({ message: text, rendered: payload });
    },
    onFailure: (issues) => Effect.fail(unrenderable(issues)),
  });
}
