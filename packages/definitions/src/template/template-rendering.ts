import { Result, type Schema } from 'effect';
import type { Emitter } from 'liquidjs';

import { engineFailureOf } from './engine-failure.ts';
import { KeptFileAsText, withKeptFilesGuarded } from './kept-files.ts';
import { renderTimeExceeded, type RenderClock } from './render-clock.ts';
import type { TemplateEngine } from './template-engine.ts';
import type { ParsedTemplate } from './template-parsing.ts';

export type RenderFailure =
  | { readonly reason: 'missing_variable'; readonly variable: string; readonly line: number }
  | { readonly reason: 'limit_exceeded'; readonly limit: 'memory' | 'time'; readonly line: number }
  | { readonly reason: 'failed'; readonly detail: string; readonly line: number };

export interface TemplateRender<Refusal> {
  readonly variables: Readonly<Record<string, Schema.Json>>;
  readonly emitter: Readonly<Emitter>;
  readonly refusalOf: (cause: unknown, line: number) => Refusal | undefined;
  readonly clock: RenderClock;
  readonly keptFileAsText?: (line: number) => Refusal;
}

const exceededLimits: ReadonlyMap<string, 'memory' | 'time'> = new Map([
  ['memory alloc limit exceeded', 'memory'],
  [renderTimeExceeded, 'time'],
]);

function failureOf<Refusal>(
  error: unknown,
  firstLine: number,
  refusalOf: TemplateRender<Refusal>['refusalOf'],
): RenderFailure | Refusal {
  const { line, message, cause, missingVariable } = engineFailureOf(error, firstLine);
  const refusal = refusalOf(cause, line);
  if (refusal !== undefined) {
    return refusal;
  }
  if (missingVariable !== undefined) {
    return { reason: 'missing_variable', variable: missingVariable, line };
  }
  const limit = [...exceededLimits].find(([words]: readonly [string, 'memory' | 'time']) =>
    message.endsWith(words),
  )?.[1];
  return limit === undefined ? { reason: 'failed', detail: message, line } : { reason: 'limit_exceeded', limit, line };
}

function refusalWithKeptFiles<Refusal>(
  refusalOf: TemplateRender<Refusal>['refusalOf'],
  keptFileAsText: (line: number) => Refusal,
): TemplateRender<Refusal>['refusalOf'] {
  return (cause, line) => (cause instanceof KeptFileAsText ? keptFileAsText(line) : refusalOf(cause, line));
}

export function renderedTemplate<Refusal>(
  engine: TemplateEngine,
  { templates, firstLine }: ParsedTemplate,
  { variables, emitter, refusalOf, clock, keptFileAsText }: TemplateRender<Refusal>,
): Result.Result<void, RenderFailure | Refusal> {
  const guarded = keptFileAsText !== undefined;
  try {
    engine.render(templates, guarded ? withKeptFilesGuarded(variables) : variables, emitter, clock);
  } catch (error) {
    const refusing = guarded ? refusalWithKeptFiles(refusalOf, keptFileAsText) : refusalOf;
    return Result.fail(failureOf(error, firstLine, refusing));
  }
  return Result.void;
}
