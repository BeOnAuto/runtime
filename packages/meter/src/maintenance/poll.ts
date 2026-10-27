import { clockMilliseconds } from '../clock/time-samples.ts';

export interface MaintenanceResult<Status extends string> {
  readonly status: Status | 'idle' | 'failed';
  readonly retryInMilliseconds: number;
}

export function scheduledMaintenance<Status extends string>(
  work: () => Promise<MaintenanceResult<Status>>,
  monotonicTime: () => number,
): () => Promise<MaintenanceResult<Status>> {
  const state: {
    failures: number;
    next: number;
    running: Promise<MaintenanceResult<Status>> | undefined;
    last: number;
  } = {
    failures: 0,
    next: 0,
    running: undefined,
    last: 0,
  };
  const attempt = async (): Promise<MaintenanceResult<Status>> => {
    try {
      const result = await work();
      state.failures = 0;
      return result;
    } catch {
      state.failures = Math.min(state.failures + 1, 8);
      return { status: 'failed', retryInMilliseconds: Math.min(3_600_000, 30_000 * 2 ** (state.failures - 1)) };
    }
  };
  return async () => {
    if (state.running !== undefined) return state.running;
    const now = clockMilliseconds(Math.floor(monotonicTime()));
    if (now < state.last) state.next = 0;
    state.last = now;
    if (now < state.next) return { status: 'idle', retryInMilliseconds: state.next - now };
    state.running = attempt();
    try {
      const result = await state.running;
      state.next = clockMilliseconds(Math.floor(monotonicTime()) + result.retryInMilliseconds);
      return result;
    } finally {
      state.running = undefined;
    }
  };
}
