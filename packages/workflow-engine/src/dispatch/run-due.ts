import type { RunState } from '../machine/run-state.ts';
import type { PositionedEvent } from '../run-log/run-event.ts';
import type { RunDue } from '../settlement/record-store.ts';

export function nextDueAtOf(state: RunState): number | null {
  const dueTimes = Object.values(state.timers.armed).map(({ dueAt }) => dueAt);
  return dueTimes.length === 0 ? null : Math.min(...dueTimes);
}

export function changesTimers({ event }: PositionedEvent): boolean {
  return (
    event.receipt.kind === 'timer_fired' ||
    event.outputs.some(({ kind }) => kind === 'arm_timer' || kind === 'cancel_timer')
  );
}

export function runDueOf(state: RunState, version: number): RunDue {
  return { runId: state.runId, version, nextDueAt: nextDueAtOf(state) };
}
