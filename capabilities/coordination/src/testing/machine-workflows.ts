import {
  ReceivedEventSchema,
  newRun,
  workflowMachine,
  type ArmedTimer,
  type JsonObject,
  type RunInput,
  type RunOutput,
  type RunState,
} from '@on.auto/workflow-engine';
import { memoryDriver, type MemoryDriver } from '@on.auto/workflow-engine/testing';
import { Option, Result, Schema } from 'effect';

import { endingOf, type WorkflowEnding } from './endings.ts';
import { answerOf, commandsOf, type DefinitionResponder } from './machine-commands.ts';
import type { Command, MachineHost, WorkflowStart } from './machine-host.ts';
import type { RunSettlement, WorkflowRun } from './run-terms.ts';
import { testSandbox, testWorkflowOptions, testWorkflowSettings } from './test-sandbox.ts';

export interface MachineOptions {
  readonly respond?: DefinitionResponder;
  readonly started?: (start: WorkflowStart, host: MachineHost) => void;
}

export interface MachineInterpretation {
  readonly ending: WorkflowEnding;
  readonly settlement: RunSettlement | undefined;
  readonly commands: readonly Command[];
  readonly fake: MachineHost;
}

const succeedWithNull: DefinitionResponder = () => ({ status: 'succeeded', output: null });

const receivedEventOf = Schema.decodeUnknownOption(ReceivedEventSchema);

function attributesOf({ run, caller }: WorkflowRun): JsonObject {
  return { org: run.org, playbook: run.playbook, run_id: run.id, definition: run.definition, caller: { ...caller } };
}

function drivenRun(run: WorkflowRun, respond: DefinitionResponder): MemoryDriver {
  return memoryDriver({
    sandbox: testSandbox,
    machine: testWorkflowSettings,
    respond: (call) => ({ later: answerOf(run, respond, call.key, call.arguments) }),
  });
}

function hooksOf(
  driver: MemoryDriver,
  run: WorkflowRun,
): { readonly start: WorkflowStart; readonly host: MachineHost } {
  const runId = run.run.id;
  const host: MachineHost = {
    commands: () => commandsOf(run, driver.ports.faults.dispatched()),
    now: driver.clock.now,
    cancelWorkflow: () => {
      driver.cancel(runId);
    },
    at: (milliseconds, action) => {
      driver.at(milliseconds, action);
    },
  };
  const start: WorkflowStart = {
    deliver: (event) => {
      Option.map(receivedEventOf(event), (received) => driver.deliver(runId, received));
    },
  };
  return { start, host };
}

export async function interpretOnMachine(run: WorkflowRun, options: MachineOptions): Promise<MachineInterpretation> {
  const runId = run.run.id;
  const driver = drivenRun(run, options.respond ?? succeedWithNull);
  driver.start({
    runId,
    document: run.document,
    input: run.input,
    limits: { mostDurationMs: run.mostDuration, longestCallMs: run.longestNestedRunMs },
    attributes: attributesOf(run),
  });
  const { start, host } = hooksOf(driver, run);
  options.started?.(start, host);
  const outcome = await driver.outcomeOf(runId);
  return {
    ending: endingOf(outcome),
    settlement: driver.ports.recordStore.settlementOf(runId),
    commands: host.commands(),
    fake: host,
  };
}

const machine = workflowMachine(testWorkflowOptions);

interface Decided {
  readonly state: RunState;
  readonly outputs: readonly RunOutput[];
}

function decidedOn({ state, outputs }: Decided, input: RunInput): Decided {
  const events = Result.getOrThrow(machine.decide(input, state));
  return {
    state: events.reduce((folded, event) => machine.evolve(folded, event), state),
    outputs: [...outputs, ...events.flatMap((event) => event.outputs)],
  };
}

function firedWhileDue(decided: Decided, runId: string): Decided {
  const due = Object.entries(decided.state.timers.armed).find(
    ([, timer]: readonly [string, ArmedTimer]) => timer.dueAt <= 0,
  );
  return due === undefined
    ? decided
    : firedWhileDue(decidedOn(decided, { kind: 'timer_fired', runId, at: 0, timerId: due[0] }), runId);
}

export function outputsAtOnce(run: WorkflowRun): readonly RunOutput[] {
  const runId = run.run.id;
  const started = decidedOn(
    { state: newRun, outputs: [] },
    {
      kind: 'started',
      runId,
      at: 0,
      document: run.document,
      input: run.input,
      limits: { mostDurationMs: run.mostDuration, longestCallMs: run.longestNestedRunMs },
      attributes: attributesOf(run),
      seed: 1,
    },
  );
  return firedWhileDue(started, runId).outputs;
}
