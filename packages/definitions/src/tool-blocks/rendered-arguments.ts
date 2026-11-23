import { randomBytes } from 'node:crypto';

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

let madeOmitPlaceholder: string | undefined;

function omitPlaceholder(): string {
  madeOmitPlaceholder ??= `__omit_place_holder__${randomBytes(20).toString('hex')}`;
  return madeOmitPlaceholder;
}

const omitName = 'omit';

export function omitVariables(): TemplateVariables {
  return { [omitName]: omitPlaceholder() };
}

const omitWithin = 'Reads omit within a value, but omit can stand only as the whole value of a key';

function omitFailure(path: string, mostBytes: number): ArgumentsFailure {
  return {
    reason: 'argument',
    argument: path,
    failure: { reason: 'failed', detail: omitWithin, line: 1 },
    most: mostBytes,
  };
}

function leavesKeysOut({ variables }: Rendering): boolean {
  return variables[omitName] === omitPlaceholder();
}

function boundOfAnArgument(rendering: Rendering): number {
  return rendering.mostBytes + 1 + (leavesKeysOut(rendering) ? bytesAsJsonOf(omitPlaceholder()) : 0);
}

function renderedString(text: string, rendering: Rendering): Result.Result<Schema.Json, TextFailure> {
  const { variables, textVariables, clock } = rendering;
  const parsed = parsedTemplate(toolBlockEngine, text, 1);
  if (Result.isFailure(parsed)) {
    return Result.fail({ reason: 'failed', detail: parsed.failure.map(({ detail }) => detail).join('; '), line: 1 });
  }
  const bound = boundOfAnArgument(rendering);
  if (passesWhole(parsed.success)) {
    return renderedValue(parsed.success, variables, bound, clock);
  }
  return isLoneExpression(text)
    ? renderedValue(parsed.success, textVariables, bound, clock)
    : renderedText(parsed.success, textVariables, bound, clock);
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

type Arguments = Readonly<Record<string, Schema.Json>>;

function objectWithKeysLeftOut(value: Arguments, path: string, mostBytes: number) {
  const placeholder = omitPlaceholder();
  const kept = Object.entries(value).filter(([, child]: JsonChild) => child !== placeholder);
  const each = kept.map(([key, child]: JsonChild) =>
    Result.map(valueWithKeysLeftOut(child, pathOf(path, key), mostBytes), (left): JsonChild => [key, left]),
  );
  return Result.map(Result.all(each), (entries: readonly JsonChild[]): Arguments => Object.fromEntries(entries));
}

function valueWithKeysLeftOut(
  value: Schema.Json,
  path: string,
  mostBytes: number,
): Result.Result<Schema.Json, ArgumentsFailure> {
  if (typeof value === 'string') {
    return value.includes(omitPlaceholder()) ? Result.fail(omitFailure(path, mostBytes)) : Result.succeed(value);
  }
  if (!isJsonParent(value)) {
    return Result.succeed(value);
  }
  if (isJsonArray(value)) {
    return Result.all(value.map((item, index) => valueWithKeysLeftOut(item, pathOf(path, String(index)), mostBytes)));
  }
  return objectWithKeysLeftOut(value, path, mostBytes);
}

function inputOf(entries: readonly JsonChild[], rendering: Rendering): Result.Result<Arguments, ArgumentsFailure> {
  const input: Arguments = Object.fromEntries(entries);
  return leavesKeysOut(rendering) ? objectWithKeysLeftOut(input, '', rendering.mostBytes) : Result.succeed(input);
}

export function renderedArgumentsOf(
  templates: Templates,
  rendering: Rendering,
): Result.Result<RenderedArguments, ArgumentsFailure> {
  return Result.flatMap(renderedEntries(childrenOf(templates), rendering, ''), (entries) =>
    Result.flatMap(inputOf(entries, rendering), (input) => {
      const bytes = bytesAsJsonOf(input);
      return bytes > rendering.mostBytes
        ? Result.fail({ reason: 'too_large', bytes, most: rendering.mostBytes })
        : Result.succeed({ input, bytes });
    }),
  );
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
