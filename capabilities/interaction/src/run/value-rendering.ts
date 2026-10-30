import { Buffer } from 'node:buffer';

import { renderedTemplate, type ParsedTemplate, type RenderClock } from '@on.auto/definitions/template';
import { Result, Schema } from 'effect';
import { toValue } from 'liquidjs';

import { interactionEngine } from '../document/request-templates.ts';
import type { TextFailure } from './text-rendering.ts';

const loneExpression = /^\{\{(?:[^}]|\}(?!\}))*\}\}$/su;

const isJson = Schema.is(Schema.Json);

export function isLoneExpression(text: string): boolean {
  return loneExpression.test(text);
}

interface ValueEmitter {
  readonly values: unknown[];
  buffer: string;
  readonly write: (html: unknown) => void;
}

function valueEmitter(): ValueEmitter {
  const emitter: ValueEmitter = {
    values: [],
    buffer: '',
    write: (html) => {
      emitter.values.push(toValue(html));
    },
  };
  return emitter;
}

function noRefusal(): undefined {
  return undefined;
}

function checkedValue(value: unknown, mostBytes: number, line: number): Result.Result<Schema.Json, TextFailure> {
  if (!isJson(value)) {
    return Result.fail({ reason: 'failed', detail: 'The expression reads a value that is not JSON', line });
  }
  return Buffer.byteLength(JSON.stringify(value), 'utf8') > mostBytes
    ? Result.fail({ reason: 'too_long', line })
    : Result.succeed(value);
}

export function renderedValue(
  parsed: ParsedTemplate,
  variables: Readonly<Record<string, Schema.Json>>,
  mostBytes: number,
  clock: RenderClock,
): Result.Result<Schema.Json, TextFailure> {
  const emitter = valueEmitter();
  return Result.flatMap(
    renderedTemplate<never>(interactionEngine, parsed, { variables, emitter, refusalOf: noRefusal, clock }),
    () => checkedValue(emitter.values[0], mostBytes, parsed.firstLine),
  );
}
