import type { CancelReason } from '../dispatch/run-output.ts';
import { field, objectField } from '../dsl/json.ts';
import { entryAt, taskEntries, type TaskEntry } from '../dsl/tasks.ts';
import type { Branch, FrameBody } from '../machine/run-state.ts';
import {
  doneOf,
  raisedOf,
  waitingOn,
  type BodyAdvance,
  type Invocation,
  type Machine,
  type Signal,
  type TaskAdvance,
} from '../runner/advance.ts';
import type { StepKey } from '../steps/step-entry.ts';

type ForkBody = Extract<FrameBody, { readonly kind: 'fork' }>;

type Failed = Extract<Branch, { readonly state: 'failed' }>;

type Finished = Extract<Branch, { readonly state: 'finished' }>;

function entriesOf(invocation: Invocation): readonly TaskEntry[] {
  const { reference } = invocation.entry;
  return taskEntries(field(objectField(invocation.entry.task, 'fork') ?? {}, 'branches'), `${reference}/fork/branches`);
}

function forkStarted({ frame }: Invocation): StepKey {
  return { reference: frame.reference, run: frame.run, outcome: 'started', times: 1 };
}

function failuresIn(branches: readonly Branch[]): number {
  return branches.filter(({ state }) => state === 'failed').length;
}

function branchOf(advance: TaskAdvance, order: number): Branch {
  if (advance.kind === 'waiting') {
    return { state: 'running', task: advance.frame };
  }
  return advance.kind === 'done'
    ? { state: 'finished', output: advance.output, flow: advance.flow }
    : { state: 'failed', error: advance.error, order };
}

function started(invocation: Invocation, entry: TaskEntry, order: number): Branch {
  const { machine, frame } = invocation;
  const { session } = machine;
  if (session.meter.shouldYield()) {
    const label = `${entry.reference} lets other workflows run`;
    return {
      state: 'yielding',
      timer: session.timers.arm({ purpose: 'yield', reference: entry.reference, milliseconds: 0, label }),
    };
  }
  return branchOf(machine.runner.startTask(machine, entry, frame.input, frame.variables), order);
}

function cancelBranch(machine: Machine, branch: Branch, reason: CancelReason): void {
  if (branch.state === 'yielding') {
    machine.session.timers.disarm(branch.timer);
  }
  if (branch.state === 'running') {
    machine.runner.cancelTask(machine, branch.task, reason);
  }
}

function isUnsettled({ state }: Branch): boolean {
  return state === 'running' || state === 'yielding';
}

function firstFailure(branches: readonly Branch[]): Failed | undefined {
  return branches
    .filter((branch): branch is Failed => branch.state === 'failed')
    .toSorted((first, second) => first.order - second.order)[0];
}

function finishedAll(invocation: Invocation, branches: readonly Branch[]): BodyAdvance {
  const finished = branches.filter((branch): branch is Finished => branch.state === 'finished');
  const { session } = invocation.machine;
  const outputs = finished.map(({ output }) => session.valueOf(output));
  return doneOf(session.hold(outputs), finished.some(({ flow }) => flow === 'end') ? 'end' : null);
}

function settledTogether(invocation: Invocation, branches: readonly Branch[]): BodyAdvance {
  const failure = firstFailure(branches);
  if (failure !== undefined) {
    for (const branch of branches) {
      cancelBranch(invocation.machine, branch, 'parent_ended');
    }
    return raisedOf(failure.error);
  }
  return branches.some((branch) => isUnsettled(branch))
    ? waitingOn({ kind: 'fork', compete: false, branches })
    : finishedAll(invocation, branches);
}

function settledCompeting(invocation: Invocation, branches: readonly Branch[]): BodyAdvance {
  const winner = branches.find((branch): branch is Finished => branch.state === 'finished');
  if (winner !== undefined) {
    for (const branch of branches) {
      cancelBranch(invocation.machine, branch, 'parent_ended');
    }
    return doneOf(winner.output, winner.flow === 'end' ? 'end' : null);
  }
  if (branches.some((branch) => isUnsettled(branch))) {
    return waitingOn({ kind: 'fork', compete: true, branches });
  }
  const failure = firstFailure(branches);
  return failure === undefined ? doneOf(invocation.machine.session.hold(null)) : raisedOf(failure.error);
}

function settled(invocation: Invocation, compete: boolean, branches: readonly Branch[]): BodyAdvance {
  return compete ? settledCompeting(invocation, branches) : settledTogether(invocation, branches);
}

export function startFork(invocation: Invocation): BodyAdvance {
  const { session } = invocation.machine;
  const compete = field(objectField(invocation.entry.task, 'fork') ?? {}, 'compete') === true;
  const branches: Branch[] = [];
  for (const entry of entriesOf(invocation)) {
    session.causedBy(forkStarted(invocation));
    branches.push(started(invocation, entry, failuresIn(branches)));
  }
  return settled(invocation, compete, branches);
}

function resumedBranch(invocation: Invocation, branch: Branch, signal: Signal, order: number): Branch {
  const { machine, frame } = invocation;
  if (branch.state === 'yielding' && signal.kind === 'timer' && signal.timerId === branch.timer) {
    const entry = entryAt(machine.session.document(), signal.timer.reference);
    machine.session.causedBy(forkStarted(invocation));
    return branchOf(machine.runner.startTask(machine, entry, frame.input, frame.variables), order);
  }
  const advance = branch.state === 'running' ? machine.runner.resumeTask(machine, branch.task, signal) : undefined;
  return advance === undefined ? branch : branchOf(advance, order);
}

export function resumeFork(invocation: Invocation, body: ForkBody, signal: Signal): BodyAdvance | undefined {
  const branches: Branch[] = [];
  for (const [index, branch] of body.branches.entries()) {
    const order = failuresIn([...branches, ...body.branches.slice(index)]);
    branches.push(resumedBranch(invocation, branch, signal, order));
  }
  return branches.every((branch, index) => branch === body.branches[index])
    ? undefined
    : settled(invocation, body.compete, branches);
}

export function cancelFork(machine: Machine, body: ForkBody, reason: CancelReason): void {
  for (const branch of body.branches) {
    cancelBranch(machine, branch, reason);
  }
}
