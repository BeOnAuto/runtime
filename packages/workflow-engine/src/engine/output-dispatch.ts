import { Effect, Result } from 'effect';

import {
  dispatchedThrough,
  type DispatchFailed,
  type OutputOrigin,
  type RunContext,
} from '../dispatch/dispatch-watermark.ts';
import { changesTimers, runDueOf } from '../dispatch/run-due.ts';
import type { RunOutput } from '../dispatch/run-output.ts';
import type { RunState } from '../machine/run-state.ts';
import type { PositionedEvent } from '../run-log/run-event.ts';
import { isTroubling } from '../settlement/record-store.ts';
import type { EnginePorts } from './engine-ports.ts';
import type { Wake } from './workflow-engine.ts';

function performed(
  ports: EnginePorts,
  run: RunContext,
  output: RunOutput,
  origin: OutputOrigin,
): Effect.Effect<unknown, DispatchFailed> {
  if (output.kind === 'arm_timer') {
    return ports.timers.arm(output, run, origin);
  }
  if (output.kind === 'cancel_timer') {
    return ports.timers.cancel(output, run);
  }
  if (output.kind === 'start_call') {
    return ports.executor.start(output, run, origin);
  }
  if (output.kind === 'cancel_call') {
    return ports.executor.cancel(output, run, origin);
  }
  if (output.kind === 'arm_listener') {
    return ports.listeners.arm(output, run, origin);
  }
  if (output.kind === 'cancel_listener') {
    return ports.listeners.cancel(output, run);
  }
  if (output.kind === 'emit_event') {
    return ports.emitter.emit(output, run, origin);
  }
  return ports.recordStore
    .settle({ runId: output.runId, settlement: output.settlement }, run, origin)
    .pipe(Effect.tap((receipt) => (isTroubling(receipt) ? ports.reporter.unsettled({ run, receipt }) : Effect.void)));
}

function isMootOnceEnded(output: RunOutput): boolean {
  return output.kind === 'start_call';
}

function firstFailureIn(
  ports: EnginePorts,
  run: RunContext,
  events: readonly PositionedEvent[],
  ended: boolean,
): Effect.Effect<number | null> {
  return Effect.gen(function* () {
    for (const { version, event } of events) {
      const origin: OutputOrigin = { version };
      for (const output of event.outputs) {
        const done = yield* Effect.result(performed(ports, run, output, origin));
        if (Result.isFailure(done) && !(ended && isMootOnceEnded(output))) {
          return version;
        }
      }
    }
    return null;
  });
}

export interface LoadedForDispatch {
  readonly runId: string;
  readonly state: RunState;
  readonly version: number;
}

function notedDue(ports: EnginePorts, run: RunContext, loaded: LoadedForDispatch): Effect.Effect<boolean> {
  const due = { ...runDueOf(loaded.state, loaded.version), runId: loaded.runId };
  return Effect.match(ports.recordStore.noteDue(due, run), { onFailure: () => false, onSuccess: () => true });
}

export function dispatchRun(ports: EnginePorts, loaded: LoadedForDispatch): Effect.Effect<Wake> {
  const { runId, state, version } = loaded;
  const run: RunContext = { runId, attributes: state.attributes };
  return Effect.gen(function* () {
    const watermark = yield* ports.watermark.read(runId);
    const events = yield* ports.runStore.eventsAfter(runId, watermark);
    const failed = yield* firstFailureIn(ports, run, events, state.status === 'ended');
    const changed = failed !== null || events.some((event) => changesTimers(event));
    const noted = changed ? yield* notedDue(ports, run, loaded) : true;
    const through = noted ? dispatchedThrough(watermark, events, failed ?? undefined) : watermark;
    yield* ports.watermark.advance(runId, through);
    return { version, dispatchedThrough: through };
  });
}
