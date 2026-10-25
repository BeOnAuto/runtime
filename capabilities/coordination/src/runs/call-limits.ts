import type { RunContext } from '@on.auto/definitions';
import { allTaskEntries, field, holdsAnExpression, type JsonObject } from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import { definitionCallOf, namesItsDefinition, type NamedRunDefinitionCall } from '../document/workflow-functions.ts';

export const callMarginMs = 60_000;

type RunLengths = Pick<RunContext, 'longestRunOf' | 'longestRunFor'>;

type ByTask = Readonly<Record<string, number>>;

type MeasureOf = (call: NamedRunDefinitionCall) => Effect.Effect<number | undefined>;

interface CalledDefinition {
  readonly reference: string;
  readonly call: NamedRunDefinitionCall;
}

function calledDefinitionOf(task: JsonObject, reference: string): readonly CalledDefinition[] {
  const call = definitionCallOf(task);
  return namesItsDefinition(call) ? [{ reference, call }] : [];
}

type TaskMeasure = readonly [string, number];

function measuredOf(reference: string, measure: number | undefined): readonly TaskMeasure[] {
  return measure === undefined ? [] : [[reference, measure]];
}

function byTaskOf(document: JsonObject, measureOf: MeasureOf): Effect.Effect<ByTask> {
  const called = allTaskEntries(field(document, 'do'), '/do').flatMap(({ task, reference }) =>
    calledDefinitionOf(task, reference),
  );
  return Effect.map(
    Effect.forEach(called, ({ reference, call }) =>
      Effect.map(measureOf(call), (measure) => measuredOf(reference, measure)),
    ),
    (measures: readonly (readonly TaskMeasure[])[]) => Object.fromEntries(measures.flat()),
  );
}

function longestOf({ type, name, given }: NamedRunDefinitionCall, { longestRunOf, longestRunFor }: RunLengths) {
  const input = field(given, 'input') ?? {};
  return holdsAnExpression(input) ? longestRunOf(type, name) : longestRunFor(type, name, input);
}

function withTheMargin(longest: number | undefined): number | undefined {
  return longest === undefined ? undefined : longest + callMarginMs;
}

export function longestCallsOf(document: JsonObject, lengths: RunLengths): Effect.Effect<ByTask> {
  return byTaskOf(document, (call) => Effect.map(longestOf(call, lengths), withTheMargin));
}

export function resumesAfterCallsOf(
  document: JsonObject,
  { resumesAfterOf }: Pick<RunContext, 'resumesAfterOf'>,
): Effect.Effect<ByTask> {
  return byTaskOf(document, ({ type, name }) => resumesAfterOf(type, name));
}
