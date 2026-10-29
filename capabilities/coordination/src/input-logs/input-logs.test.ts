import {
  evolveRun,
  isRecordedStep,
  newRun,
  workflowMachine,
  type RunLogEvent,
  type RunState,
  type Step,
  type StepCause,
} from '@on.auto/workflow-engine';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { testWorkflowOptions } from '../testing/test-sandbox.ts';
import { recordedInputLogs, recordInputLog, type InputLog } from './input-log-corpus.ts';
import { inputLogOf, inputLogPaths } from './input-log-paths.ts';

const machine = workflowMachine(testWorkflowOptions);

function replayed({ inputs }: InputLog): readonly RunLogEvent[] {
  const events: RunLogEvent[] = [];
  let state = newRun;
  for (const input of inputs) {
    for (const event of Result.getOrThrow(machine.decide(input, state))) {
      state = evolveRun(state, event);
      events.push(event);
    }
  }
  return events;
}

const committed = new Map(recordedInputLogs().map((log) => [log.name, log]));

const endings = new Map(inputLogPaths.map(({ name, ends }) => [name, ends]));

function endedFrom(events: readonly RunLogEvent[]): RunState {
  return events.reduce((state, event) => evolveRun(state, event), newRun);
}

function isSameEntry(step: Step, cause: StepCause): boolean {
  return (
    cause !== 'input' &&
    step.reference === cause.reference &&
    step.run === cause.run &&
    step.outcome === cause.outcome &&
    step.times === cause.times
  );
}

function causesNotRecordedBefore(events: readonly RunLogEvent[]): readonly StepCause[] {
  const entries = events.flatMap(({ steps }) => steps.filter((step) => isRecordedStep(step)));
  return entries.flatMap(({ caused_by: cause }, index) =>
    cause === 'input' || entries.slice(0, index).some((step) => isSameEntry(step, cause)) ? [] : [cause],
  );
}

describe('the recorded input logs of workflows', () => {
  it.each(recordedInputLogs())('$name replays through the machine to the events it recorded', (log) => {
    expect(replayed(log)).toEqual(log.events);
  });

  it.each(inputLogPaths.map(({ name }) => name))('%s runs today as it was recorded', (name) => {
    const log = inputLogOf(name);
    recordInputLog(log, process.env);

    expect(log).toEqual(committed.get(name));
  });

  it.each(recordedInputLogs())('$name ends as its path was recorded to end', ({ name, events }) => {
    expect(endedFrom(events).outcome).toEqual(endings.get(name));
  });

  it.each(recordedInputLogs())('$name names, for every step, a cause recorded before it', ({ events }) => {
    expect(causesNotRecordedBefore(events)).toEqual([]);
  });

  it('are the seventeen paths of the corpus', () => {
    expect([...committed.keys()]).toEqual(inputLogPaths.map(({ name }) => name).toSorted());
  });
});
