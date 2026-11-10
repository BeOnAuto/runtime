import { Buffer } from 'node:buffer';

import { toolBounds } from '@on.auto/tool-servers';
import { Result, type Schema } from 'effect';

import type { RenderClock } from '../template/render-clock.ts';
import { parsedTemplate } from '../template/template-parsing.ts';
import { childrenOf, isJsonArray, isJsonParent, type JsonChild } from './json-children.ts';
import { renderedText, toolBlockEngine, type TextFailure } from './text-rendering.ts';
import { isLoneExpression, renderedValue } from './value-rendering.ts';

export type Templates = Readonly<Record<string, Schema.Json>>;

export type TemplateVariables = Readonly<Record<string, Schema.Json>>;

export type ArgumentsFailure =
  | { readonly reason: 'argument'; readonly argument: string; readonly failure: TextFailure }
  | { readonly reason: 'too_large'; readonly bytes: number };

export interface RenderedArguments {
  readonly input: Readonly<Record<string, Schema.Json>>;
  readonly bytes: number;
}

const mostBytes = toolBounds.argumentBytes + 1;

function renderedString(
  text: string,
  variables: TemplateVariables,
  clock: RenderClock,
): Result.Result<Schema.Json, TextFailure> {
  const parsed = parsedTemplate(toolBlockEngine, text, 1);
  if (Result.isFailure(parsed)) {
    return Result.fail({ reason: 'failed', detail: parsed.failure.map(({ detail }) => detail).join('; '), line: 1 });
  }
  return isLoneExpression(text)
    ? renderedValue(parsed.success, variables, mostBytes, clock)
    : renderedText(parsed.success, variables, mostBytes, clock);
}

function pathOf(path: string, key: string): string {
  return path === '' ? key : `${path}/${key}`;
}

function renderedEntries(
  entries: readonly JsonChild[],
  variables: TemplateVariables,
  path: string,
  clock: RenderClock,
): Result.Result<readonly JsonChild[], ArgumentsFailure> {
  const rendered: JsonChild[] = [];
  for (const [key, value] of entries) {
    const each = renderedJson(value, variables, pathOf(path, key), clock);
    if (Result.isFailure(each)) {
      return Result.fail(each.failure);
    }
    rendered.push([key, each.success]);
  }
  return Result.succeed(rendered);
}

function renderedJson(
  value: Schema.Json,
  variables: TemplateVariables,
  path: string,
  clock: RenderClock,
): Result.Result<Schema.Json, ArgumentsFailure> {
  if (typeof value === 'string') {
    return Result.mapError(renderedString(value, variables, clock), (failure) => ({
      reason: 'argument',
      argument: path,
      failure,
    }));
  }
  if (!isJsonParent(value)) {
    return Result.succeed(value);
  }
  return Result.map(renderedEntries(childrenOf(value), variables, path, clock), (rendered) =>
    isJsonArray(value) ? rendered.map(([, item]) => item) : Object.fromEntries(rendered),
  );
}

export function renderedArguments(
  templates: Templates,
  variables: TemplateVariables,
  clock: RenderClock,
): Result.Result<RenderedArguments, ArgumentsFailure> {
  return Result.flatMap(renderedEntries(childrenOf(templates), variables, '', clock), (entries) => {
    const input = Object.fromEntries(entries);
    const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
    return bytes > toolBounds.argumentBytes
      ? Result.fail({ reason: 'too_large', bytes })
      : Result.succeed({ input, bytes });
  });
}

export const notTextRemedy = 'write | json after it, or write it alone as one {{ }} to send it as it is';

const failureWords: Readonly<Record<TextFailure['reason'], string>> = {
  not_text: `renders a value that is not text among text; ${notTextRemedy}`,
  too_long: `renders more than the ${toolBounds.argumentBytes} bytes a call may send`,
  missing_variable: 'reads a value it does not have',
  limit_exceeded: 'cannot be rendered within the limits of a template',
  failed: 'cannot be rendered',
};

export const smallerInputRemedy = 'give the function a smaller input';

export function isOversized(failure: ArgumentsFailure): boolean {
  return failure.reason === 'too_large' || failure.failure.reason === 'too_long';
}

function wordsOf(failure: ArgumentsFailure, call: string): string {
  return failure.reason === 'too_large'
    ? `The arguments of ${call} take ${failure.bytes} bytes, more than the ${toolBounds.argumentBytes} a call may send`
    : `The argument ${failure.argument} of ${call} ${failureWords[failure.failure.reason]}`;
}

export function argumentsFailureWords(failure: ArgumentsFailure, call: string, remedy?: string): string {
  const words = wordsOf(failure, call);
  return remedy !== undefined && isOversized(failure) ? `${words}; ${remedy}` : words;
}

export function momentVariables(input: Schema.Json, at: string): TemplateVariables {
  return { input, today: at.slice(0, 10), now: at };
}
