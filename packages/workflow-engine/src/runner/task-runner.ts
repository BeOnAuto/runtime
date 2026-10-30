import { admitted, holds, transform } from '../dsl/evaluation.ts';
import type { Variables } from '../dsl/evaluation.ts';
import { field, objectField, textField, type Json } from '../dsl/json.ts';
import { caughtRaise, raised } from '../dsl/raised-error.ts';
import { timedOut, timeoutMilliseconds } from '../dsl/task-outcomes.ts';
import { entryAt, typeOf, type TaskEntry } from '../dsl/tasks.ts';
import type { TaskFrame, ValueId, Variables as Scope } from '../machine/run-state.ts';
import { cancelBody, resumeBody, startBody } from '../tasks/task-bodies.ts';
import {
  raisedOf,
  type BodyAdvance,
  type CancelReason,
  type FramePrefix,
  type Invocation,
  type Machine,
  type Signal,
  type TaskAdvance,
} from './advance.ts';
import { descriptorOf, taskVariablesOf, withInput } from './task-variables.ts';

function caught(machine: Machine, frame: FramePrefix, attempt: () => TaskAdvance): TaskAdvance {
  return caughtRaise(attempt, (error) => {
    machine.session.timers.disarm(frame.timeout);
    machine.session.record({ reference: frame.reference, run: frame.run, outcome: 'raised', error });
    return raisedOf(error);
  });
}

function invocationOf(machine: Machine, frame: FramePrefix, entry: TaskEntry): Invocation {
  const { session } = machine;
  const type = typeOf(entry.task);
  if (type === undefined) {
    throw raised('configuration', 400, 'The task has no type this runtime knows', entry.reference);
  }
  const input = session.valueOf(frame.input);
  return {
    machine,
    frame,
    entry,
    kind: type.kind,
    configuration: type.configuration,
    input,
    variables: withInput(taskVariablesOf(session, frame, entry), input),
  };
}

function exported(invocation: Invocation, output: Json, variables: Variables): void {
  const { machine, entry } = invocation;
  const { session } = machine;
  const exportAs = field(objectField(entry.task, 'export') ?? {}, 'as');
  if (exportAs !== undefined) {
    const context = transform(
      exportAs,
      output,
      { ...variables, output, context: session.valueOf(session.context()) },
      session.placeAt(entry.reference),
    );
    session.replaceContext(session.hold(admitted(context, entry.reference)));
  }
}

function finished(invocation: Invocation, output: ValueId, flow: string | null): TaskAdvance {
  const { machine, entry, frame } = invocation;
  const { session } = machine;
  const value = admitted(session.valueOf(output), entry.reference);
  const variables = { ...invocation.variables, task: { ...descriptorOf(session, frame, entry), output: value } };
  const shaped = admitted(
    transform(field(objectField(entry.task, 'output') ?? {}, 'as'), value, variables, session.placeAt(entry.reference)),
    entry.reference,
  );
  exported(invocation, shaped, variables);
  session.timers.disarm(frame.timeout);
  session.record({ reference: entry.reference, run: frame.run, outcome: 'completed' });
  return {
    kind: 'done',
    output: shaped === value ? output : session.hold(shaped),
    flow: flow ?? textField(entry.task, 'then') ?? 'continue',
  };
}

function settled(invocation: Invocation, advance: BodyAdvance): TaskAdvance {
  const { machine, frame } = invocation;
  if (advance.kind === 'waiting') {
    return { kind: 'waiting', frame: { ...frame, body: advance.body } };
  }
  if (advance.kind === 'raised') {
    machine.session.timers.disarm(frame.timeout);
    machine.session.record({ reference: frame.reference, run: frame.run, outcome: 'raised', error: advance.error });
    return advance;
  }
  return finished(invocation, advance.output, advance.flow);
}

function performed(machine: Machine, entry: TaskEntry, frame: FramePrefix): TaskAdvance {
  const { session } = machine;
  const variables = taskVariablesOf(session, frame, entry);
  const place = session.placeAt(entry.reference);
  const rawValue = session.valueOf(frame.rawInput);
  if (!holds(field(entry.task, 'if'), rawValue, variables, place)) {
    session.record({ reference: entry.reference, run: frame.run, outcome: 'skipped' });
    return { kind: 'done', output: frame.rawInput, flow: 'continue' };
  }
  const milliseconds = timeoutMilliseconds(field(entry.task, 'timeout'), session.components().timeouts, {
    data: rawValue,
    variables,
    place,
  });
  const timeout =
    milliseconds === undefined
      ? null
      : session.timers.arm({
          purpose: 'timeout',
          reference: entry.reference,
          milliseconds,
          label: `${entry.reference} timeout`,
        });
  const timed = { ...frame, timeout };
  return caught(machine, timed, () => {
    const inputValue = transform(field(objectField(entry.task, 'input') ?? {}, 'from'), rawValue, variables, place);
    const input = inputValue === rawValue ? frame.rawInput : session.hold(inputValue);
    const invocation = invocationOf(machine, { ...timed, input }, entry);
    return settled(invocation, startBody(invocation.kind, invocation));
  });
}

export function startTask(machine: Machine, entry: TaskEntry, rawInput: ValueId, scope: Scope): TaskAdvance {
  const { session } = machine;
  session.meter.countTask();
  const run = session.nextRun(entry.reference);
  const frame: FramePrefix = {
    reference: entry.reference,
    run,
    startedAt: session.now,
    context: session.context(),
    rawInput,
    input: rawInput,
    variables: scope,
    timeout: null,
  };
  session.record({ reference: entry.reference, run, outcome: 'started' });
  return caught(machine, frame, () => {
    session.step(entry.reference);
    return performed(machine, entry, frame);
  });
}

export function resumeTask(machine: Machine, frame: TaskFrame, signal: Signal): TaskAdvance | undefined {
  const { session } = machine;
  session.continues(frame);
  if (signal.kind === 'timer' && signal.timerId === frame.timeout) {
    cancelBody(machine, frame, 'deadline');
    const { error } = timedOut(signal.timer.dueAt - signal.timer.armedAt, frame.reference);
    session.record({ reference: frame.reference, run: frame.run, outcome: 'timed_out', error });
    return raisedOf(error);
  }
  const entry = entryAt(session.document(), frame.reference);
  const resumed = caught(machine, frame, () => {
    const invocation = invocationOf(machine, frame, entry);
    const advance = resumeBody(invocation, frame.body, signal);
    return advance === undefined ? { kind: 'waiting', frame } : settled(invocation, advance);
  });
  return resumed.kind === 'waiting' && resumed.frame === frame ? undefined : resumed;
}

export function cancelTask(machine: Machine, frame: TaskFrame, reason: CancelReason): void {
  machine.session.continues(frame);
  machine.session.timers.disarm(frame.timeout);
  cancelBody(machine, frame, reason);
  machine.session.record({ reference: frame.reference, run: frame.run, outcome: 'cancelled' });
}

export function invocationAt(machine: Machine, frame: TaskFrame): Invocation {
  return invocationOf(machine, frame, entryAt(machine.session.document(), frame.reference));
}
