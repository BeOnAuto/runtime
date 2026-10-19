import { Buffer } from 'node:buffer';

import {
  outputText,
  renderedTemplate,
  type ParsedTemplate,
  type RenderClock,
  type RenderFailure,
} from '@on.auto/definitions/template';
import { Predicate, Result, type Schema } from 'effect';
import { toValue } from 'liquidjs';

import { interactionEngine } from '../document/request-templates.ts';

type TextRefusal =
  | { readonly reason: 'not_text'; readonly line: number }
  | { readonly reason: 'too_long'; readonly line: number };

export type TextFailure = RenderFailure | TextRefusal;

class TextRefused extends Error {
  readonly refusal: TextRefusal['reason'];

  constructor(refusal: TextRefusal['reason']) {
    super(refusal);
    this.refusal = refusal;
  }
}

interface TextEmitter {
  buffer: string;
  readonly write: (html: unknown) => void;
}

function textEmitter(mostBytes: number): TextEmitter {
  const emitter: TextEmitter = {
    buffer: '',
    write: (html) => {
      const value: unknown = toValue(html);
      if (Predicate.isObjectOrArray(value)) {
        throw new TextRefused('not_text');
      }
      emitter.buffer += outputText(value);
      if (Buffer.byteLength(emitter.buffer, 'utf8') > mostBytes) {
        throw new TextRefused('too_long');
      }
    },
  };
  return emitter;
}

function refusalOf(cause: unknown, line: number): TextRefusal | undefined {
  return cause instanceof TextRefused ? { reason: cause.refusal, line } : undefined;
}

export function renderedText(
  parsed: ParsedTemplate,
  variables: Readonly<Record<string, Schema.Json>>,
  mostBytes: number,
  clock: RenderClock,
): Result.Result<string, TextFailure> {
  const emitter = textEmitter(mostBytes);
  return Result.map(
    renderedTemplate(interactionEngine, parsed, { variables, emitter, refusalOf, clock }),
    () => emitter.buffer,
  );
}
