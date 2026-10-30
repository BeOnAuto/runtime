import type { CallResult } from '@on.auto/operations';

import type { CancelReason } from '../dispatch/run-output.ts';

export type { CancelReason } from '../dispatch/run-output.ts';
import type { Variables } from '../dsl/evaluation.ts';
import type { Json } from '../dsl/json.ts';
import type { TaskEntry, TaskKind } from '../dsl/tasks.ts';
import type { ReceivedEvent } from '../inbox/received-event.ts';
import type { DslError } from '../machine/dsl-error.ts';
import type {
  ArmedTimer,
  FrameBody,
  ListCursor,
  TaskFrame,
  ValueId,
  Variables as Scope,
} from '../machine/run-state.ts';
import type { Session } from './session.ts';

export type Signal =
  | { readonly kind: 'timer'; readonly timerId: string; readonly timer: ArmedTimer }
  | { readonly kind: 'answer'; readonly key: string; readonly result: CallResult }
  | { readonly kind: 'events' }
  | { readonly kind: 'offer'; readonly listener: string; readonly slot: number; readonly event: ReceivedEvent };

export interface Raised {
  readonly kind: 'raised';
  readonly error: DslError;
}

export type TaskAdvance =
  | { readonly kind: 'waiting'; readonly frame: TaskFrame }
  | { readonly kind: 'done'; readonly output: ValueId; readonly flow: string }
  | Raised;

export type BodyAdvance =
  | { readonly kind: 'waiting'; readonly body: FrameBody }
  | { readonly kind: 'done'; readonly output: ValueId; readonly flow: string | null }
  | Raised;

type ListEnding = 'completed' | 'exited' | 'ended';

export type ListAdvance =
  | { readonly kind: 'waiting'; readonly cursor: ListCursor }
  | { readonly kind: 'ended'; readonly output: ValueId; readonly ending: ListEnding }
  | Raised;

export interface ListStart {
  readonly pointer: string;
  readonly data: ValueId;
  readonly variables: Scope;
}

export interface Runner {
  readonly startTask: (machine: Machine, entry: TaskEntry, rawInput: ValueId, scope: Scope) => TaskAdvance;
  readonly resumeTask: (machine: Machine, frame: TaskFrame, signal: Signal) => TaskAdvance | undefined;
  readonly cancelTask: (machine: Machine, frame: TaskFrame, reason: CancelReason) => void;
  readonly invocationAt: (machine: Machine, frame: TaskFrame) => Invocation;
  readonly startList: (machine: Machine, start: ListStart) => ListAdvance;
  readonly yieldList: (machine: Machine, start: ListStart, reference: string) => ListAdvance;
  readonly resumeList: (machine: Machine, cursor: ListCursor, signal: Signal) => ListAdvance | undefined;
  readonly cancelList: (machine: Machine, cursor: ListCursor, reason: CancelReason) => void;
}

export interface Machine {
  readonly session: Session;
  readonly runner: Runner;
}

export type FramePrefix = Omit<TaskFrame, 'body'>;

export interface Invocation {
  readonly machine: Machine;
  readonly frame: FramePrefix;
  readonly entry: TaskEntry;
  readonly kind: TaskKind;
  readonly configuration: Json;
  readonly input: Json;
  readonly variables: Variables;
}

export function raisedOf(error: DslError): Raised {
  return { kind: 'raised', error };
}

export function doneOf(output: ValueId, flow: string | null = null): BodyAdvance {
  return { kind: 'done', output, flow };
}

export function waitingOn(body: FrameBody): BodyAdvance {
  return { kind: 'waiting', body };
}

export function listBodyOf(advance: ListAdvance): BodyAdvance {
  if (advance.kind === 'waiting') {
    return waitingOn({ kind: 'list', list: advance.cursor });
  }
  return advance.kind === 'ended' ? doneOf(advance.output, advance.ending === 'ended' ? 'end' : null) : advance;
}
