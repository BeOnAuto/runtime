import type { Conflict, ContentKeeper, StreamReader, Unavailable } from '@on.auto/operations';
import { outputPayloadOf, type Payload } from '@on.auto/operations/payloads';
import { Effect, type Schema } from 'effect';

import type { RunResult } from '../runs/run-commands.ts';
import { runDecider } from '../runs/run-decider.ts';
import { startedRunOf } from '../runs/run-state.ts';
import { comparedWithoutItsValue, keptToCompare, type ValuesRead } from './payload-comparisons.ts';
import { payloadWrittenIn, type PayloadWritten } from './payload-writing.ts';
import { payloadsKeptIn, valuesReadFor } from './run-payloads.ts';

export interface Resulted {
  readonly result: RunResult;
  readonly inHand: ValuesRead;
}

export type WrittenOutput = (output: Payload<Schema.Json>) => Effect.Effect<PayloadWritten>;

interface PlaybookOfRun {
  readonly org: string;
  readonly playbook: string;
}

interface SettledComparison {
  readonly run: PlaybookOfRun;
  readonly stream: string;
  readonly offered: Resulted;
}

export interface SettledOutputs {
  readonly written: (run: PlaybookOfRun) => WrittenOutput;
  readonly toCompare: (comparison: SettledComparison) => Effect.Effect<ValuesRead, Unavailable | Conflict>;
}

export function resultedAlone(result: RunResult): Resulted {
  return { result, inHand: new Map() };
}

export const outputsAsGiven: SettledOutputs = {
  written: () => (output) => Effect.succeed({ payload: output, inHand: new Map() }),
  toCompare: () => Effect.fail(comparedWithoutItsValue),
};

function keptToRead(recorded: RunResult | undefined, { result, inHand }: Resulted) {
  const kept =
    recorded?.type === 'run_succeeded' && result.type === 'run_succeeded'
      ? keptToCompare(outputPayloadOf(recorded), outputPayloadOf(result))
      : [];
  return kept.filter(({ sha256 }) => !inHand.has(sha256));
}

export function outputsKeptIn(ledger: StreamReader & ContentKeeper): SettledOutputs {
  return {
    written: (run) => payloadWrittenIn(ledger.content, run),
    toCompare: ({ run, stream, offered }) =>
      Effect.gen(function* () {
        const { state } = yield* ledger.load(stream, runDecider);
        const kept = keptToRead(startedRunOf(state)?.result, offered);
        const read = yield* valuesReadFor(kept, payloadsKeptIn(ledger.content, run));
        return new Map([...offered.inHand, ...read]);
      }),
  };
}

export function settledComparing<A, E>(
  outputs: SettledOutputs,
  comparison: SettledComparison,
  settled: (valuesRead: ValuesRead) => Effect.Effect<A, E>,
): Effect.Effect<A, E | Unavailable | Conflict> {
  return settled(comparison.offered.inHand).pipe(
    Effect.catchIf(
      (refused: unknown) => refused === comparedWithoutItsValue,
      () => Effect.flatMap(outputs.toCompare(comparison), settled),
    ),
  );
}
