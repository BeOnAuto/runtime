import type { RunInput } from '../src/machine/run-input.ts';
import type { RunState } from '../src/machine/run-state.ts';
import { armedTimerIds } from '../src/testing/run-history.ts';
import { workflow } from '../src/testing/workflows.ts';

export const runId = '0199a3c4-7d2e-7c1a-9b3f-000000040000';

export const startedAt = 1_790_845_200_000;

const utf8 = new TextEncoder();

export function textBytesOf(text: string): number {
  return utf8.encode(text).byteLength;
}

export function jsonBytesOf(value: unknown): number {
  return textBytesOf(JSON.stringify(value));
}

export function looping(inputs: number): ReturnType<typeof workflow> {
  return workflow(`
do:
  - tick: { wait: PT1S }
  - count: { set: '\${ ({ n: ($data.n ?? 0) + 1 }) }' }
  - again: { switch: [{ more: { when: '\${ $data.n < ${inputs - 1} }', then: tick } }] }
`);
}

export function nextTick(state: RunState): RunInput {
  const [timerId = ''] = armedTimerIds(state, 'wait');
  const at = state.timers.armed[timerId]?.dueAt ?? state.lastInputAt;
  return { kind: 'timer_fired', runId: state.runId, at, timerId };
}

export function millisecondsOf(work: () => void): number {
  const started = performance.now();
  work();
  return performance.now() - started;
}

export function medianMillisecondsOf(times: number, work: () => void): number {
  const samples = Array.from({ length: times }, () => millisecondsOf(work)).toSorted((first, second) => first - second);
  return samples[Math.floor(times / 2)] ?? 0;
}
