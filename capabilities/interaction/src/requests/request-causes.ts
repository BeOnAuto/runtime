import { PlaybookReader, type RecordedFact } from '@on.auto/operations';
import { Effect } from 'effect';

import type { OpenRequestRow } from './request-rows.ts';

export const mostCauses = 8;

interface RequestWithin {
  readonly run_id: string;
  readonly workflow: string;
  readonly step: string;
}

export interface RequestChain {
  readonly within: RequestWithin;
  readonly causes: readonly string[];
}

type Reader = PlaybookReader['Service'];

function firstFactOf(reader: Reader, run: string): Effect.Effect<RecordedFact | undefined> {
  return reader.readRecorded({ kind: 'run', run }, { order: 'asc', limit: 1, dataOf: [] }).pipe(
    Effect.map(({ records: [first] }) => first),
    Effect.orDie,
  );
}

function runBefore(reader: Reader, { context, causationId }: RecordedFact): Effect.Effect<string | undefined> {
  if (context.calledBy !== undefined) {
    return Effect.succeed(context.calledBy.runId);
  }
  if (context.trigger?.kind !== 'event' || causationId === null) {
    return Effect.undefined;
  }
  return Effect.map(reader.readRecordedEvent(causationId), (cause) => cause?.context.runId);
}

function causesFrom(
  reader: Reader,
  fact: RecordedFact | undefined,
  causes: readonly string[],
): Effect.Effect<readonly string[]> {
  if (fact === undefined || causes.length >= mostCauses) {
    return Effect.succeed(causes);
  }
  return Effect.flatMap(runBefore(reader, fact), (before) =>
    before === undefined || causes.includes(before)
      ? Effect.succeed(causes)
      : Effect.flatMap(firstFactOf(reader, before), (earlier) => causesFrom(reader, earlier, [...causes, before])),
  );
}

const noChain: Partial<RequestChain> = {};

export const requestChainOf = Effect.fnUntraced(function* ({
  within_run: run,
  within_step: step,
}: Pick<OpenRequestRow, 'within_run' | 'within_step'>) {
  if (run === null || step === null) {
    return noChain;
  }
  const reader = yield* PlaybookReader;
  const first = yield* firstFactOf(reader, run);
  if (first?.context.definitionName === undefined) {
    return noChain;
  }
  const within: RequestWithin = { run_id: run, workflow: first.context.definitionName, step };
  const chain: Partial<RequestChain> = { within, causes: yield* causesFrom(reader, first, [run]) };
  return chain;
});
