import type { TaskKind } from '../dsl/tasks.ts';
import type { FrameBody, TaskFrame } from '../machine/run-state.ts';
import {
  listBodyOf,
  type BodyAdvance,
  type CancelReason,
  type Invocation,
  type Machine,
  type Signal,
} from '../runner/advance.ts';
import { cancelAdmission, cancelCall, resumeAdmission, resumeCall, startCall } from './call-task.ts';
import { startEmit } from './emit-task.ts';
import { cancelFor, resumeFor, startFor } from './for-task.ts';
import { cancelFork, resumeFork, startFork } from './fork-task.ts';
import { cancelListen, resumeListen, startListen } from './listen-task.ts';
import { cancelWait, resumeWait, startRaise, startRejected, startSet, startSwitch, startWait } from './simple-tasks.ts';
import { cancelTry, resumeTry, startTry } from './try-task.ts';

type ListBody = Extract<FrameBody, { readonly kind: 'list' }>;

function startDo(invocation: Invocation): BodyAdvance {
  const { machine, entry, frame } = invocation;
  return listBodyOf(
    machine.runner.startList(machine, {
      pointer: `${entry.reference}/do`,
      data: frame.input,
      variables: frame.variables,
    }),
  );
}

function resumeDo({ machine }: Invocation, body: ListBody, signal: Signal): BodyAdvance | undefined {
  const advance = machine.runner.resumeList(machine, body.list, signal);
  return advance === undefined ? undefined : listBodyOf(advance);
}

const starters: Readonly<Record<TaskKind, (invocation: Invocation) => BodyAdvance>> = {
  call: startCall,
  do: startDo,
  emit: startEmit,
  for: startFor,
  fork: startFork,
  listen: startListen,
  raise: startRaise,
  run: startRejected,
  set: startSet,
  switch: startSwitch,
  try: startTry,
  wait: startWait,
};

export function startBody(kind: TaskKind, invocation: Invocation): BodyAdvance {
  return starters[kind](invocation);
}

export function resumeBody(invocation: Invocation, body: FrameBody, signal: Signal): BodyAdvance | undefined {
  if (body.kind === 'list') {
    return resumeDo(invocation, body, signal);
  }
  if (body.kind === 'for') {
    return resumeFor(invocation, body, signal);
  }
  if (body.kind === 'fork') {
    return resumeFork(invocation, body, signal);
  }
  if (body.kind === 'try') {
    return resumeTry(invocation, body, signal);
  }
  if (body.kind === 'wait') {
    return resumeWait(invocation, body, signal);
  }
  if (body.kind === 'admission') {
    return resumeAdmission(invocation, body, signal);
  }
  return body.kind === 'call' ? resumeCall(invocation, body, signal) : resumeListen(invocation, body, signal);
}

export function cancelBody(
  machine: Machine,
  frame: Pick<TaskFrame, 'reference' | 'run' | 'body'>,
  reason: CancelReason,
): void {
  const { body } = frame;
  if (body.kind === 'list') {
    machine.runner.cancelList(machine, body.list, reason);
  } else if (body.kind === 'for') {
    cancelFor(machine, body, reason);
  } else if (body.kind === 'fork') {
    cancelFork(machine, body, reason);
  } else if (body.kind === 'try') {
    cancelTry(machine, body, reason);
  } else if (body.kind === 'wait') {
    cancelWait(machine, body);
  } else if (body.kind === 'call') {
    cancelCall(machine, body, reason);
  } else if (body.kind === 'admission') {
    cancelAdmission(machine, body);
  } else {
    cancelListen(machine, frame);
  }
}
