import { Result } from 'effect';

import type { RunInput } from '../src/machine/run-input.ts';
import { newRun, type RunState } from '../src/machine/run-state.ts';
import { testWorkflowMachine } from '../src/pool-testing/test-sandbox.ts';
import { eventBytesOf, type PositionedEvent } from '../src/run-log/run-event.ts';
import { evolveRun, loadedRunOf } from '../src/run-log/run-fold.ts';
import type { StoredRun } from '../src/run-log/run-store.ts';
import { isSnapshotDue, snapshotChunks, snapshotOf } from '../src/run-log/snapshot.ts';
import { startedOf } from '../src/testing/driver-inputs.ts';
import {
  runId,
  jsonBytesOf,
  looping,
  medianMillisecondsOf,
  millisecondsOf,
  nextTick,
  startedAt,
  textBytesOf,
} from './common.ts';

interface Loop {
  readonly events: readonly PositionedEvent[];
  readonly state: RunState;
  readonly milliseconds: number;
}

interface Stored {
  readonly fullest: StoredRun;
  readonly last: StoredRun;
}

function decidedAlone(inputs: number): Loop {
  const events: PositionedEvent[] = [];
  const run: { state: RunState; input: RunInput } = {
    state: newRun,
    input: startedOf({ runId, document: looping(inputs) }, startedAt),
  };
  const milliseconds = millisecondsOf(() => {
    while (run.state.status !== 'ended') {
      for (const event of Result.getOrThrow(testWorkflowMachine.decide(run.input, run.state))) {
        run.state = evolveRun(run.state, event);
        events.push({ version: events.length + 1, event });
      }
      run.input = nextTick(run.state);
    }
  });
  return { events, state: run.state, milliseconds };
}

function storedAlong(events: readonly PositionedEvent[]): Stored {
  const kept: { state: RunState; snapshot: StoredRun['snapshot']; tail: PositionedEvent[]; bytes: number } = {
    state: newRun,
    snapshot: null,
    tail: [],
    bytes: 0,
  };
  const before: { fullest: StoredRun } = { fullest: { snapshot: null, tail: [] } };
  for (const positioned of events) {
    kept.state = evolveRun(kept.state, positioned.event);
    kept.tail.push(positioned);
    kept.bytes += eventBytesOf(positioned.event);
    if (isSnapshotDue({ bytes: kept.bytes, snapshotBytes: kept.snapshot?.bytes ?? 0 })) {
      before.fullest = { snapshot: kept.snapshot, tail: kept.tail.slice(0, -1) };
      const snapshot = snapshotOf(kept.state, positioned.version);
      kept.snapshot = { snapshot, bytes: snapshotChunks(snapshot).reduce((sum, chunk) => sum + textBytesOf(chunk), 0) };
      kept.tail = [];
      kept.bytes = 0;
    }
  }
  return { fullest: before.fullest, last: { snapshot: kept.snapshot, tail: kept.tail } };
}

function loadMilliseconds(stored: StoredRun): string {
  return medianMillisecondsOf(51, () => {
    loadedRunOf(stored);
  }).toFixed(3);
}

function eventLines({ events }: Loop): readonly string[] {
  const { event } = events[20_000] ?? { event: undefined };
  return event === undefined
    ? []
    : [
        `the event of input 20,001: ${eventBytesOf(event)} bytes; ${event.patch.length} patch operations, ${jsonBytesOf(event.patch)} bytes; ${event.steps.length} steps, ${jsonBytesOf(event.steps)} bytes; outputs ${jsonBytesOf(event.outputs)} bytes; receipt ${jsonBytesOf(event.receipt)} bytes`,
      ];
}

function loadLines({ fullest, last }: Stored): readonly string[] {
  const snapshotBytes = fullest.snapshot?.bytes ?? 0;
  return [
    `a load from a snapshot of ${snapshotBytes} bytes: ${loadMilliseconds({ ...fullest, tail: [] })} ms with no event after it, ${loadMilliseconds({ ...fullest, tail: fullest.tail.slice(0, 46) })} ms with 46, ${loadMilliseconds(fullest)} ms with ${fullest.tail.length}, the most before the next snapshot is due`,
    `the run resumed after its last input: ${loadMilliseconds(last)} ms with ${last.tail.length} events after its last snapshot`,
  ];
}

export function loopMeasured(inputs: number): readonly string[] {
  const loop = decidedAlone(inputs);
  const { historyBytes } = loop.state;
  const cold = millisecondsOf(() => {
    loadedRunOf({ snapshot: null, tail: loop.events });
  });
  return [
    `the machine alone, ${inputs} inputs decided and folded: ${(loop.milliseconds / 1000).toFixed(2)} s, ${Math.round((inputs * 1000) / loop.milliseconds)} inputs a second, ${((loop.milliseconds * 1000) / inputs).toFixed(0)} µs an input`,
    `the history of those inputs: ${historyBytes} bytes, ${(historyBytes / 1_048_576).toFixed(2)} MiB, ${(historyBytes / inputs).toFixed(1)} bytes an input`,
    ...eventLines(loop),
    `the ${inputs} events folded cold: ${(cold / 1000).toFixed(2)} s, ${((cold * 1000) / inputs).toFixed(1)} µs an event`,
    ...loadLines(storedAlong(loop.events)),
  ];
}
