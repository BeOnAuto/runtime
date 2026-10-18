import type { RunContext } from '@on.auto/definitions';
import { allTaskEntries, field, holdsAnExpression, type JsonObject } from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import { definitionCallOf, namesItsDefinition, type NamedRunDefinitionCall } from '../document/workflow-functions.ts';

export const callMarginMs = 60_000;

type RunLengths = Pick<RunContext, 'longestRunOf' | 'longestRunFor'>;

interface CalledDefinition {
  readonly reference: string;
  readonly longest: (lengths: RunLengths) => Effect.Effect<number | undefined>;
}

function longestOf({ type, name, given }: NamedRunDefinitionCall): CalledDefinition['longest'] {
  const input = field(given, 'input') ?? {};
  return holdsAnExpression(input)
    ? ({ longestRunOf }) => longestRunOf(type, name)
    : ({ longestRunFor }) => longestRunFor(type, name, input);
}

function calledDefinitionOf(task: JsonObject, reference: string): readonly CalledDefinition[] {
  const call = definitionCallOf(task);
  return namesItsDefinition(call) ? [{ reference, longest: longestOf(call) }] : [];
}

type CallLimit = readonly [string, number];

function limitOf(reference: string, longest: number | undefined): readonly CallLimit[] {
  return longest === undefined ? [] : [[reference, longest + callMarginMs]];
}

export function longestCallsOf(
  document: JsonObject,
  lengths: RunLengths,
): Effect.Effect<Readonly<Record<string, number>>> {
  const called = allTaskEntries(field(document, 'do'), '/do').flatMap(({ task, reference }) =>
    calledDefinitionOf(task, reference),
  );
  return Effect.map(
    Effect.forEach(called, ({ reference, longest }) =>
      Effect.map(longest(lengths), (longestMs) => limitOf(reference, longestMs)),
    ),
    (limits: readonly (readonly CallLimit[])[]) => Object.fromEntries(limits.flat()),
  );
}
