import { sendableInWords } from '@on.auto/tool-servers';
import { Result, type Schema } from 'effect';

import type { RenderClock } from '../template/render-clock.ts';
import { parsedTemplate, type VariableReference } from '../template/template-parsing.ts';
import { bytesAsJsonOf } from './bytes-as-json.ts';
import { childrenOf, isJsonArray, isJsonParent, type JsonChild } from './json-children.ts';
import { renderedText, toolBlockEngine, type TextFailure } from './text-rendering.ts';
import { isLoneExpression, passesWhole, renderedValue } from './value-rendering.ts';

export type Templates = Readonly<Record<string, Schema.Json>>;

export type TemplateVariables = Readonly<Record<string, Schema.Json>>;

export type ArgumentsFailure =
  | { readonly reason: 'argument'; readonly argument: string; readonly failure: TextFailure; readonly most: number }
  | { readonly reason: 'too_large'; readonly bytes: number; readonly most: number };

export interface RenderedArguments {
  readonly input: Readonly<Record<string, Schema.Json>>;
  readonly bytes: number;
}

interface Rendering {
  readonly variables: TemplateVariables;
  readonly textVariables: TemplateVariables;
  readonly clock: RenderClock;
  readonly mostBytes: number;
}

function renderedString(
  text: string,
  { variables, textVariables, clock, mostBytes }: Rendering,
): Result.Result<Schema.Json, TextFailure> {
  const parsed = parsedTemplate(toolBlockEngine, text, 1);
  if (Result.isFailure(parsed)) {
    return Result.fail({ reason: 'failed', detail: parsed.failure.map(({ detail }) => detail).join('; '), line: 1 });
  }
  if (passesWhole(parsed.success)) {
    return renderedValue(parsed.success, variables, mostBytes + 1, clock);
  }
  return isLoneExpression(text)
    ? renderedValue(parsed.success, textVariables, mostBytes + 1, clock)
    : renderedText(parsed.success, textVariables, mostBytes + 1, clock);
}

function templatesIn(value: Schema.Json): readonly string[] {
  if (typeof value === 'string') {
    return [value];
  }
  return isJsonParent(value) ? childrenOf(value).flatMap(([, child]) => templatesIn(child)) : [];
}

export function variablesReadInside(templates: Templates): readonly VariableReference[] {
  return templatesIn(templates).flatMap((text) => {
    const parsed = parsedTemplate(toolBlockEngine, text, 1);
    return Result.isSuccess(parsed) && !passesWhole(parsed.success) ? parsed.success.variables : [];
  });
}

function pathOf(path: string, key: string): string {
  return path === '' ? key : `${path}/${key}`;
}

function renderedEntries(
  entries: readonly JsonChild[],
  rendering: Rendering,
  path: string,
): Result.Result<readonly JsonChild[], ArgumentsFailure> {
  const rendered: JsonChild[] = [];
  for (const [key, value] of entries) {
    const each = renderedJson(value, rendering, pathOf(path, key));
    if (Result.isFailure(each)) {
      return Result.fail(each.failure);
    }
    rendered.push([key, each.success]);
  }
  return Result.succeed(rendered);
}

function renderedJson(
  value: Schema.Json,
  rendering: Rendering,
  path: string,
): Result.Result<Schema.Json, ArgumentsFailure> {
  if (typeof value === 'string') {
    return Result.mapError(renderedString(value, rendering), (failure) => ({
      reason: 'argument',
      argument: path,
      failure,
      most: rendering.mostBytes,
    }));
  }
  if (!isJsonParent(value)) {
    return Result.succeed(value);
  }
  return Result.map(renderedEntries(childrenOf(value), rendering, path), (rendered) =>
    isJsonArray(value) ? rendered.map(([, item]) => item) : Object.fromEntries(rendered),
  );
}

export function renderedArgumentsOf(
  templates: Templates,
  rendering: Rendering,
): Result.Result<RenderedArguments, ArgumentsFailure> {
  return Result.flatMap(renderedEntries(childrenOf(templates), rendering, ''), (entries) => {
    const input = Object.fromEntries(entries);
    const bytes = bytesAsJsonOf(input);
    return bytes > rendering.mostBytes
      ? Result.fail({ reason: 'too_large', bytes, most: rendering.mostBytes })
      : Result.succeed({ input, bytes });
  });
}

export function renderedArguments(
  templates: Templates,
  variables: TemplateVariables,
  clock: RenderClock,
  mostBytes: number,
): Result.Result<RenderedArguments, ArgumentsFailure> {
  return renderedArgumentsOf(templates, { variables, textVariables: variables, clock, mostBytes });
}

export const notTextRemedy = 'write | json after it, or write it alone as one {{ }} to send it as it is';

function failureWords(reason: TextFailure['reason'], most: number): string {
  const words: Readonly<Record<TextFailure['reason'], string>> = {
    not_text: `renders a value that is not text among text; ${notTextRemedy}`,
    too_long: `renders more than ${sendableInWords(most)}`,
    missing_variable: 'reads a value it does not have',
    limit_exceeded: 'cannot be rendered within the limits of a template',
    failed: 'cannot be rendered',
  };
  return words[reason];
}

export const smallerInputRemedy = 'give the function a smaller input';

export const smallerTemplatesRemedy = 'make its templates render less';

export function isOversized(failure: ArgumentsFailure): boolean {
  return failure.reason === 'too_large' || failure.failure.reason === 'too_long';
}

function wordsOf(failure: ArgumentsFailure, call: string): string {
  return failure.reason === 'too_large'
    ? `The arguments of ${call} take ${failure.bytes} bytes, more than ${sendableInWords(failure.most)}`
    : `The argument ${failure.argument} of ${call} ${failureWords(failure.failure.reason, failure.most)}`;
}

export function argumentsFailureWords(failure: ArgumentsFailure, call: string, remedy?: string): string {
  const words = wordsOf(failure, call);
  return remedy !== undefined && isOversized(failure) ? `${words}; ${remedy}` : words;
}

export function momentVariables(input: Schema.Json, at: string): TemplateVariables {
  return { input, today: at.slice(0, 10), now: at };
}
