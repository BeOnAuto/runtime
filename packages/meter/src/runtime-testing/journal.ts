import type { Fold, Recorded, StreamReader, StreamState } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { dispatchRequest } from './fixture.ts';

function afterEvents<State, Event extends Recorded>(
  fold: Fold<State, Event>,
  events: readonly unknown[],
): StreamState<State> {
  let state = fold.initialState;
  const decode = Schema.decodeUnknownSync(fold.eventSchema);
  for (const event of events) state = fold.evolve(state, decode(event));
  return { state, version: events.length };
}

export function journalWith(events: readonly unknown[]): StreamReader {
  return { load: (_stream, fold) => Effect.sync(() => afterEvents(fold, events)) };
}

export function runFacts(
  changes: {
    readonly definition?: Readonly<{ type: string; name: string; version: number }>;
    readonly input?: Schema.Json;
    readonly finished?: boolean;
  } = {},
): readonly unknown[] {
  const run = dispatchRequest();
  const definition = changes.definition ?? run.definition;
  const context = {
    runId: run.runId,
    definitionType: definition.type,
    definitionName: definition.name,
    definitionVersion: definition.version,
    by: run.caller.id,
    at: '2026-10-27T00:00:00.000Z',
  };
  return [
    {
      type: 'run_started',
      data: { input: changes.input ?? run.input, started_by: { id: run.caller.id, name: run.caller.name } },
      context,
    },
    ...(changes.finished === false
      ? []
      : [{ type: 'run_succeeded', data: { output: { doubled: 6 }, record: {} }, context }]),
  ];
}
