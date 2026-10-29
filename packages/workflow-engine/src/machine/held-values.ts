import { Data } from 'effect';

import { jsonBytesOf } from '../dsl/json.ts';
import { taskFrameBytes } from './limits.ts';
import type { Branch, FrameBody, HeldValue, ListCursor, RunState, TaskFrame, ValueId } from './run-state.ts';

interface Reach {
  readonly values: readonly ValueId[];
  readonly frames: number;
}

export class MissingValue extends Data.TaggedError('missing_value')<{ readonly value: ValueId }> {}

const nothing: Reach = { values: [], frames: 0 };

function together(reaches: readonly Reach[]): Reach {
  return {
    values: reaches.flatMap(({ values }: Reach) => values),
    frames: reaches.reduce((sum, { frames }: Reach) => sum + frames, 0),
  };
}

function cursorReach(cursor: ListCursor): Reach {
  const own: Reach = { values: [cursor.data, ...Object.values(cursor.variables)], frames: 0 };
  return cursor.current.kind === 'running' ? together([own, frameReach(cursor.current.task)]) : own;
}

function branchReach(branch: Branch): Reach {
  if (branch.state === 'running') {
    return frameReach(branch.task);
  }
  return branch.state === 'finished' ? { values: [branch.output], frames: 0 } : nothing;
}

function bodyReach(body: FrameBody): Reach {
  if (body.kind === 'list') {
    return cursorReach(body.list);
  }
  if (body.kind === 'for') {
    return together([{ values: [body.items, body.data], frames: 0 }, cursorReach(body.list)]);
  }
  if (body.kind === 'fork') {
    return together(body.branches.map((branch: Branch) => branchReach(branch)));
  }
  if (body.kind === 'try') {
    return body.phase.kind === 'backing_off' ? nothing : cursorReach(body.phase.list);
  }
  if (body.kind === 'call' || body.kind === 'admission') {
    return { values: [body.arguments], frames: 0 };
  }
  return body.kind === 'listen'
    ? { values: body.consumed.filter((consumed): consumed is ValueId => consumed !== null), frames: 0 }
    : nothing;
}

function frameReach(frame: TaskFrame): Reach {
  const own: Reach = {
    values: [frame.context, frame.rawInput, frame.input, ...Object.values(frame.variables)],
    frames: 1,
  };
  return together([own, bodyReach(frame.body)]);
}

function runReach({ machine, workflow }: RunState): Reach {
  const roots: Reach = { values: workflow === null ? [machine.context] : [machine.context, workflow.input], frames: 0 };
  return machine.root === null ? roots : together([roots, frameReach(machine.root)]);
}

export function heldIn(values: Readonly<Record<string, HeldValue>>, id: ValueId): HeldValue {
  const held = Object.hasOwn(values, id) ? values[id] : undefined;
  if (held === undefined) {
    throw new MissingValue({ value: id });
  }
  return held;
}

export function heldValueOf(state: RunState, id: ValueId): HeldValue {
  return heldIn(state.machine.values, id);
}

export function reachableValueIds(state: RunState): readonly ValueId[] {
  return [...new Set(runReach(state).values)].toSorted((first, second) => first - second);
}

export function heldBytesOf(state: RunState): number {
  const valueBytes = reachableValueIds(state).reduce((sum, id) => sum + heldValueOf(state, id).bytes, 0);
  const documentBytes = state.workflow === null ? 0 : jsonBytesOf(state.workflow.document);
  return valueBytes + runReach(state).frames * taskFrameBytes + documentBytes;
}

export function withReachableValuesOnly(state: RunState): RunState {
  const values = Object.fromEntries(reachableValueIds(state).map((id) => [id, heldValueOf(state, id)]));
  return { ...state, heldBytes: heldBytesOf(state), machine: { ...state.machine, values } };
}
