import type { CancelReason } from '../dispatch/run-output.ts';
import { valueAtPointer } from '../dsl/json.ts';
import { caughtRaise, raised } from '../dsl/raised-error.ts';
import { taskEntries, type TaskEntry } from '../dsl/tasks.ts';
import type { ListCursor, TaskFrame } from '../machine/run-state.ts';
import type { StepCause } from '../steps/step-entry.ts';
import {
  raisedOf,
  type ListAdvance,
  type ListStart,
  type Machine,
  type Raised,
  type Signal,
  type TaskAdvance,
} from './advance.ts';

type Position = Omit<ListCursor, 'current'>;

interface Place {
  readonly position: Position;
  readonly entries: readonly TaskEntry[];
  readonly reference: string;
}

function caught<T>(attempt: () => T): T | Raised {
  return caughtRaise<T | Raised>(attempt, raisedOf);
}

function entriesOf(machine: Machine, { pointer }: Position): readonly TaskEntry[] {
  return taskEntries(valueAtPointer(machine.session.document(), pointer), pointer);
}

function positionOf({ entries, reference }: Place, name: string): number {
  const position = entries.findIndex((candidate) => candidate.name === name);
  if (position === -1) {
    throw raised('configuration', 400, `then: ${name} names no task in the same list`, reference);
  }
  return position;
}

function running(position: Position, task: TaskFrame): ListAdvance {
  return { kind: 'waiting', cursor: { ...position, current: { kind: 'running', task } } };
}

function afterTask(machine: Machine, place: Place, advance: TaskAdvance): ListAdvance {
  const { position } = place;
  if (advance.kind === 'waiting') {
    return running(position, advance.frame);
  }
  if (advance.kind === 'raised') {
    return advance;
  }
  const { output, flow } = advance;
  if (flow === 'end' || flow === 'exit') {
    return { kind: 'ended', output, ending: flow === 'end' ? 'ended' : 'exited' };
  }
  const next = flow === 'continue' ? position.position + 1 : positionOf(place, flow);
  return runFrom(machine, { ...position, position: next, data: output }, true);
}

function yielded(machine: Machine, position: Position, reference: string): ListAdvance {
  const label = `${reference} lets other workflows run`;
  const timer = machine.session.timers.arm({ purpose: 'yield', reference, milliseconds: 0, label });
  const after = machine.session.cause();
  return { kind: 'waiting', cursor: { ...position, current: { kind: 'yielding', timer, after } } };
}

function resumedAfterYield(machine: Machine, position: Position, after: StepCause): ListAdvance {
  machine.session.causedBy(after);
  return runFrom(machine, position, false);
}

function runFrom(machine: Machine, position: Position, mayYield: boolean): ListAdvance {
  const { session, runner } = machine;
  const entries = entriesOf(machine, position);
  const entry = entries[position.position];
  if (entry === undefined) {
    return { kind: 'ended', output: position.data, ending: 'completed' };
  }
  if (mayYield && session.meter.shouldYield()) {
    return yielded(machine, position, entry.reference);
  }
  const advance = runner.startTask(machine, entry, position.data, position.variables);
  return afterTask(machine, { position, entries, reference: entry.reference }, advance);
}

export function startList(machine: Machine, { pointer, data, variables }: ListStart): ListAdvance {
  return caught(() => runFrom(machine, { pointer, position: 0, data, variables }, true));
}

export function yieldList(machine: Machine, { pointer, data, variables }: ListStart, reference: string): ListAdvance {
  return yielded(machine, { pointer, position: 0, data, variables }, reference);
}

function resumeRunning(machine: Machine, cursor: ListCursor, task: TaskFrame, signal: Signal): ListAdvance | undefined {
  const advance = machine.runner.resumeTask(machine, task, signal);
  const { current: _current, ...position } = cursor;
  return advance === undefined
    ? undefined
    : afterTask(machine, { position, entries: entriesOf(machine, position), reference: task.reference }, advance);
}

export function resumeList(machine: Machine, cursor: ListCursor, signal: Signal): ListAdvance | undefined {
  return caught(() => {
    const { current, ...position } = cursor;
    if (current.kind === 'running') {
      return resumeRunning(machine, cursor, current.task, signal);
    }
    return signal.kind === 'timer' && signal.timerId === current.timer
      ? resumedAfterYield(machine, position, current.after)
      : undefined;
  });
}

export function cancelList(machine: Machine, { current }: ListCursor, reason: CancelReason): void {
  if (current.kind === 'yielding') {
    machine.session.timers.disarm(current.timer);
    return;
  }
  machine.runner.cancelTask(machine, current.task, reason);
}
