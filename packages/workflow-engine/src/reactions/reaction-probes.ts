import { Effect } from 'effect';

import type { OutputOrigin, RunContext } from '../dispatch/dispatch-watermark.ts';
import type { ArmListener, CancelListener, EmitEvent } from '../dispatch/run-output.ts';
import type { Probe } from '../testing/port-probes.ts';
import type { Emitter, Listeners } from './reaction-ports.ts';

export interface ListenerSubject {
  readonly listeners: Listeners;
  readonly run: RunContext;
  readonly otherRun: RunContext;
}

export interface EmitterSubject {
  readonly emitter: Emitter;
  readonly run: RunContext;
}

const armedBy: OutputOrigin = { version: 2 };

function listenerOf({ runId }: RunContext, reference: string): ArmListener {
  return {
    kind: 'arm_listener',
    key: { runId, reference, run: 1 },
    filters: [{ type: 'com.acme.closed', data: { region: 'eu' } }],
  };
}

export const listenerProbes: readonly Probe<ListenerSubject>[] = [
  {
    title: 'arms a listener once and cancels it once',
    expected: ['armed', 'already_armed', 'cancelled', 'not_armed'],
    run: ({ listeners, run }) =>
      Effect.gen(function* () {
        const listener = listenerOf(run, '/do/0/await');
        const cancel: CancelListener = { kind: 'cancel_listener', key: listener.key };
        return [
          yield* listeners.arm(listener, run, armedBy),
          yield* listeners.arm(listener, run, armedBy),
          yield* listeners.cancel(cancel, run),
          yield* listeners.cancel(cancel, run),
        ];
      }),
  },
  {
    title: 'keeps apart the listeners of two runs at the same task',
    expected: ['armed', 'armed', 'cancelled', 'cancelled'],
    run: ({ listeners, run, otherRun }) =>
      Effect.gen(function* () {
        const own = listenerOf(run, '/do/0/same');
        const other = listenerOf(otherRun, '/do/0/same');
        return [
          yield* listeners.arm(own, run, armedBy),
          yield* listeners.arm(other, otherRun, armedBy),
          yield* listeners.cancel({ kind: 'cancel_listener', key: own.key }, run),
          yield* listeners.cancel({ kind: 'cancel_listener', key: other.key }, otherRun),
        ];
      }),
  },
];

function emissionOf({ runId }: RunContext): EmitEvent {
  return {
    kind: 'emit_event',
    key: { runId, reference: '/do/0/announce', run: 1 },
    event: {
      specversion: '1.0',
      id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
      source: '/acme/ledger',
      type: 'com.acme.closed',
      time: '2026-10-01T09:00:00.000Z',
      data: { region: 'eu' },
    },
  };
}

export const emitterProbes: readonly Probe<EmitterSubject>[] = [
  {
    title: 'records an emitted event once, however often its output is dispatched',
    expected: ['recorded', 'already_recorded'],
    run: ({ emitter, run }) =>
      Effect.gen(function* () {
        const emission = emissionOf(run);
        return [yield* emitter.emit(emission, run, armedBy), yield* emitter.emit(emission, run, armedBy)];
      }),
  },
];
