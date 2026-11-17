import { Result, Schema } from 'effect';
import { Output, toValue } from 'liquidjs';

import type { RenderClock } from '../template/render-clock.ts';
import type { ParsedTemplate } from '../template/template-parsing.ts';
import { renderedTemplate } from '../template/template-rendering.ts';
import { bytesAsJsonOf } from './bytes-as-json.ts';
import { toolBlockEngine, type TextFailure } from './text-rendering.ts';

const loneExpression = /^\{\{(?:[^}]|\}(?!\}))*\}\}$/su;

const isJson = Schema.is(Schema.Json);

export function isLoneExpression(text: string): boolean {
  return loneExpression.test(text);
}

function appliesAFilter(parsed: ParsedTemplate): boolean {
  for (const template of parsed.templates()) {
    if (template instanceof Output && template.value.filters.length > 0) {
      return true;
    }
  }
  return false;
}

export function passesWhole(parsed: ParsedTemplate): boolean {
  return isLoneExpression(parsed.text) && !appliesAFilter(parsed);
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

function notText(line: number): TextFailure {
  return { reason: 'not_text', line };
}

function checkedValue(value: unknown, mostBytes: number, line: number): Result.Result<Schema.Json, TextFailure> {
  if (!isJson(value)) {
    return Result.fail({ reason: 'failed', detail: 'The expression reads a value that is not JSON', line });
  }
  return bytesAsJsonOf(value) > mostBytes ? Result.fail({ reason: 'too_long', line }) : Result.succeed(value);
}

export function renderedValue(
  parsed: ParsedTemplate,
  variables: Readonly<Record<string, Schema.Json>>,
  mostBytes: number,
  clock: RenderClock,
): Result.Result<Schema.Json, TextFailure> {
  const emitter = valueEmitter();
  return Result.flatMap(
    renderedTemplate(toolBlockEngine, parsed, {
      variables,
      emitter,
      refusalOf: noRefusal,
      clock,
      ...(passesWhole(parsed) ? {} : { keptFileAsText: notText }),
    }),
    () => checkedValue(emitter.values[0], mostBytes, parsed.firstLine),
  );
}
