import { describe, expect, it } from 'vitest';

import {
  heldBytesOf,
  MissingValue,
  newRun,
  reachableValueIds,
  taskFrameBytes,
  withReachableValuesOnly,
  type Branch,
  type FrameBody,
  type HeldValue,
  type ListCursor,
  type RunState,
  type TaskFrame,
} from '../index.ts';
import { runningState } from '../testing/runs.ts';

type Choose = (modulus: number) => number;

const valueCount = 16;

const valueKeys = new Set(['context', 'rawInput', 'input', 'data', 'items', 'output', 'arguments']);

const utf8 = new TextEncoder();

function chooserOf(seed: number): Choose {
  const drawn = { state: seed };
  return (modulus) => {
    drawn.state = (drawn.state * 48_271) % 2_147_483_647;
    return drawn.state % modulus;
  };
}

function cursorOf(choose: Choose, depth: number): ListCursor {
  const running = depth > 0 && choose(3) > 0;
  const idle = { kind: 'yielding' as const, timer: 't', after: 'input' as const };
  return {
    pointer: '/do',
    position: choose(4),
    data: choose(valueCount),
    variables: { item: choose(valueCount) },
    current: running ? { kind: 'running', task: frameOf(choose, depth - 1) } : idle,
  };
}

function branchOf(choose: Choose, depth: number): Branch {
  const kind = choose(4);
  if (kind === 3) {
    return { state: 'yielding', timer: 't' };
  }
  if (kind === 0) {
    return { state: 'running', task: frameOf(choose, Math.max(depth - 1, 0)) };
  }
  return kind === 1
    ? { state: 'finished', output: choose(valueCount), flow: 'continue' }
    : { state: 'failed', error: { type: 'runtime', status: 500, instance: '/do/0' }, order: 0 };
}

function bodyOf(choose: Choose, depth: number): FrameBody {
  const kinds: readonly (() => FrameBody)[] = [
    () => ({ kind: 'list', list: cursorOf(choose, depth) }),
    () => ({
      kind: 'for',
      items: choose(valueCount),
      index: 0,
      data: choose(valueCount),
      list: cursorOf(choose, depth),
    }),
    () => ({ kind: 'fork', compete: false, branches: [branchOf(choose, depth), branchOf(choose, depth)] }),
    () => ({
      kind: 'try',
      attempt: 1,
      startedAt: 0,
      phase: { kind: 'trying', list: cursorOf(choose, depth), attemptLimit: null },
    }),
    () => ({ kind: 'try', attempt: 2, startedAt: 0, phase: { kind: 'recovering', list: cursorOf(choose, depth) } }),
    () => ({
      kind: 'try',
      attempt: 2,
      startedAt: 0,
      phase: {
        kind: 'backing_off',
        timer: 't',
        error: { type: 'runtime', status: 500, instance: '/do/0' },
        failed: 'input',
      },
    }),
    () => ({ kind: 'wait', timer: 't' }),
    () => ({
      kind: 'call',
      key: { runId: 'e', reference: '/do/0', run: 1 },
      function: 'notify',
      arguments: choose(valueCount),
      label: 'notify',
      deadline: 't',
    }),
    () => ({ kind: 'listen', consumed: [choose(valueCount), choose(valueCount)], waited: 1 }),
  ];
  return kinds[choose(kinds.length)]?.() ?? { kind: 'wait', timer: 't' };
}

function frameOf(choose: Choose, depth: number): TaskFrame {
  return {
    reference: '/do/0',
    run: 1,
    startedAt: 0,
    context: choose(valueCount),
    rawInput: choose(valueCount),
    input: choose(valueCount),
    variables: { attempt: choose(valueCount) },
    timeout: null,
    body: bodyOf(choose, depth),
  };
}

function stateOf(seed: number): RunState {
  const choose = chooserOf(seed);
  const values: Record<string, HeldValue> = Object.fromEntries(
    Array.from({ length: valueCount }, (_, id) => [id, { value: `v${id}`, bytes: 10 + choose(1000) }]),
  );
  return {
    ...newRun,
    runId: 'e',
    status: 'running',
    workflow: { document: { do: [{ seed }] }, input: choose(valueCount) },
    machine: { values, nextValue: valueCount, context: choose(valueCount), root: frameOf(choose, 3) },
  };
}

function idsHeldIn(node: unknown): readonly number[] {
  if (Array.isArray(node)) {
    return node.flatMap((item: unknown) => idsHeldIn(item));
  }
  if (typeof node !== 'object' || node === null) {
    return [];
  }
  return Object.entries(node).flatMap(([key, item]: readonly [string, unknown]) => {
    if (valueKeys.has(key) && typeof item === 'number') {
      return [item];
    }
    if ((key === 'variables' || key === 'consumed') && typeof item === 'object' && item !== null) {
      return Object.values(item).filter((id): id is number => typeof id === 'number');
    }
    return idsHeldIn(item);
  });
}

function framesIn(node: unknown): number {
  if (Array.isArray(node)) {
    return node.reduce((sum: number, item: unknown) => sum + framesIn(item), 0);
  }
  if (typeof node !== 'object' || node === null) {
    return 0;
  }
  const own = Object.hasOwn(node, 'rawInput') ? 1 : 0;
  return Object.values(node).reduce((sum: number, item: unknown) => sum + framesIn(item), own);
}

function expectedHeldBytes(state: RunState): number {
  const ids = new Set([
    state.machine.context,
    ...(state.workflow === null ? [] : [state.workflow.input]),
    ...idsHeldIn(state.machine.root),
  ]);
  const valueBytes = [...ids].reduce((sum, id) => sum + (state.machine.values[id]?.bytes ?? 0), 0);
  const documentBytes = utf8.encode(JSON.stringify(state.workflow?.document)).byteLength;
  return valueBytes + framesIn(state.machine.root) * taskFrameBytes + documentBytes;
}

const seeds = Array.from({ length: 400 }, (_, index) => index + 1);

describe('the data a run holds', () => {
  it('is, for any state, the bytes of the values its frames, context and input reach, 4 KiB a frame, and the document', () => {
    const states = seeds.map((seed) => stateOf(seed));

    expect(states.map((state) => heldBytesOf(state))).toEqual(states.map((state) => expectedHeldBytes(state)));
  });

  it('keeps, after the sweep that follows each decision, exactly the values that are reached, and the same bytes', () => {
    const swept = seeds.map((seed) => withReachableValuesOnly(stateOf(seed)));

    expect(swept.map((state) => Object.keys(state.machine.values).map(Number))).toEqual(
      seeds.map((seed) => reachableValueIds(stateOf(seed))),
    );
    expect(swept.map((state) => state.heldBytes)).toEqual(swept.map((state) => expectedHeldBytes(state)));
    expect(swept.some((state) => Object.keys(state.machine.values).length < valueCount)).toBe(true);
  });

  it('of a new run is its empty context alone: no document, no input and no frame yet', () => {
    expect([reachableValueIds(newRun), heldBytesOf(newRun)]).toEqual([[0], 2]);
  });

  it('lets go of a value nothing reaches any more, such as the answer of a call once it moved on', () => {
    const answered = { ...runningState.machine.values, 7: { value: { answer: 1 }, bytes: 11 } };

    const swept = withReachableValuesOnly({ ...runningState, machine: { ...runningState.machine, values: answered } });

    expect(Object.keys(swept.machine.values)).toEqual(['0', '1', '2']);
  });

  it('dies on a value that is reached but missing, a state no decision may leave', () => {
    const { 2: _approval, ...values } = runningState.machine.values;

    expect(() => heldBytesOf({ ...runningState, machine: { ...runningState.machine, values } })).toThrow(
      new MissingValue({ value: 2 }),
    );
  });
});
