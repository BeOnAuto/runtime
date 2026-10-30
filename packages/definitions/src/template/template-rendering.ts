import { Result, type Schema } from 'effect';
import type { Emitter } from 'liquidjs';

import { engineFailureOf } from './engine-failure.ts';
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
  const limit = exceededLimits.get(message);
  return limit === undefined ? { reason: 'failed', detail: message, line } : { reason: 'limit_exceeded', limit, line };
}

export function renderedTemplate<Refusal>(
  engine: TemplateEngine,
  { templates, firstLine }: ParsedTemplate,
  { variables, emitter, refusalOf, clock }: TemplateRender<Refusal>,
): Result.Result<void, RenderFailure | Refusal> {
  try {
    engine.render(templates, variables, emitter, clock);
  } catch (error) {
    return Result.fail(failureOf(error, firstLine, refusalOf));
  }
  return Result.void;
}
