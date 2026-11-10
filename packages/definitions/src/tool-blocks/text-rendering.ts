import { Buffer } from 'node:buffer';

import { Predicate, Result, type Schema } from 'effect';
import { toValue } from 'liquidjs';

import { outputText } from '../template/output-text.ts';
import type { RenderClock } from '../template/render-clock.ts';
import { templateEngine } from '../template/template-engine.ts';
import type { ParsedTemplate } from '../template/template-parsing.ts';
import { renderedTemplate, type RenderFailure } from '../template/template-rendering.ts';

export const toolBlockEngine = templateEngine();

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
  bytes: number;
  lastCodeUnit: number | undefined;
  readonly write: (html: unknown) => void;
}

interface CodeUnits {
  readonly first: number;
  readonly last: number;
}

const highSurrogates: CodeUnits = { first: 0xd8_00, last: 0xdb_ff };

const lowSurrogates: CodeUnits = { first: 0xdc_00, last: 0xdf_ff };

const bytesSavedByAJoinedPair = 2;

function isWithin(code: number | undefined, { first, last }: CodeUnits): boolean {
  return code !== undefined && code >= first && code <= last;
}

function bytesAdded(lastCodeUnit: number | undefined, text: string): number {
  const joinsAPair = isWithin(lastCodeUnit, highSurrogates) && isWithin(text.codePointAt(0), lowSurrogates);
  return Buffer.byteLength(text, 'utf8') - (joinsAPair ? bytesSavedByAJoinedPair : 0);
}

function textEmitter(mostBytes: number): TextEmitter {
  const emitter: TextEmitter = {
    buffer: '',
    bytes: 0,
    lastCodeUnit: undefined,
    write: (html) => {
      const value: unknown = toValue(html);
      if (Predicate.isObjectOrArray(value)) {
        throw new TextRefused('not_text');
      }
      const text = outputText(value);
      emitter.bytes += bytesAdded(emitter.lastCodeUnit, text);
      emitter.buffer += text;
      emitter.lastCodeUnit = text.codePointAt(text.length - 1) ?? emitter.lastCodeUnit;
      if (emitter.bytes > mostBytes) {
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
    renderedTemplate(toolBlockEngine, parsed, { variables, emitter, refusalOf, clock }),
    () => emitter.buffer,
  );
}
