import { Effect } from 'effect';

import type { Submission, WorkflowEngine } from '../engine/workflow-engine.ts';
import type { CancelOrder, EventOffered, EventReceived, RunInput } from '../machine/run-input.ts';
import type { Responder } from '../memory/memory-executor.ts';
import { memoryPorts, type MemoryPorts } from '../memory/memory-ports.ts';
import { virtualClock, type VirtualClock } from '../memory/virtual-clock.ts';
import type { MachineOptions, MachineSettings } from '../runner/run-descriptors.ts';
import { startedOf, testCancel, testMachineOf, type StartRequest } from './driver-inputs.ts';
import { engineOfFrozenRuns } from './frozen-runs.ts';
import { runWatchOf, type RunWatch } from './run-watch.ts';

export interface DriverOptions {
  readonly sandbox: MachineOptions['sandbox'];
  readonly machine?: MachineSettings;
  readonly respond?: Responder;
  readonly startedAt?: number;
  readonly mostSteps?: number;
}

export interface MemoryDriver extends RunWatch {
  readonly ports: MemoryPorts;
  readonly engine: WorkflowEngine;
  readonly clock: VirtualClock;
  readonly start: (request: StartRequest) => Submission;
  readonly submit: (input: RunInput) => Submission;
  readonly deliver: (runId: string, event: EventReceived['event']) => Submission;
  readonly offer: (offer: Omit<EventOffered, 'kind' | 'at'>) => Submission;
  readonly cancel: (runId: string, order?: CancelOrder) => Submission;
  readonly at: (milliseconds: number, action: () => void) => void;
  readonly inputsOf: (runId: string) => readonly RunInput[];
}

const succeedWithNull: Responder = () => ({ result: { status: 'succeeded', output: null } });

export function memoryDriver(options: DriverOptions): MemoryDriver {
  const clock = virtualClock(options.startedAt);
  const ports = memoryPorts(
    clock,
    (input) => {
      submit(input);
    },
    options.respond ?? succeedWithNull,
  );
  const engine = engineOfFrozenRuns(ports, testMachineOf(options.sandbox, options.machine));
  const given: RunInput[] = [];
  function submit(input: RunInput): Submission {
    given.push(input);
    return Effect.runSync(engine.submit(input));
  }
  return {
    ...runWatchOf(ports.runStore, clock, options.mostSteps),
    ports,
    engine,
    clock,
    start: (request) => {
      ports.recordStore.known(request.runId);
      return submit(startedOf(request, clock.now()));
    },
    submit,
    deliver: (runId, event) => submit({ kind: 'event_received', runId, at: clock.now(), event }),
    offer: (offer) => submit({ ...offer, kind: 'event_offered', at: clock.now() }),
    cancel: (runId, order = testCancel) => submit({ kind: 'cancel_requested', runId, at: clock.now(), cancel: order }),
    at: (milliseconds, action) => {
      const due = clock.now() + milliseconds;
      clock.schedule(due, `scheduled ${due} ${clock.pending()}`, action);
    },
    inputsOf: (runId) => given.filter((input) => input.runId === runId),
  };
}
