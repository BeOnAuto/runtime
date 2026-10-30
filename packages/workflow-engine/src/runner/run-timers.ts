import type { CancelReason } from '../dispatch/run-output.ts';
import type { Json, JsonObject } from '../dsl/json.ts';
import { callKeyText, type CallKey } from '../executor/call-key.ts';
import type { ArmedTimer, RunState } from '../machine/run-state.ts';
import type { TimerPurpose } from '../timers/timer-id.ts';
import type { Descriptors } from './run-descriptors.ts';
import type { Journal } from './run-tables.ts';

interface TimerRequest {
  readonly purpose: TimerPurpose;
  readonly reference: string;
  readonly milliseconds: number;
  readonly label: string;
}

export interface TimerTable {
  readonly arm: (request: TimerRequest) => string;
  readonly disarm: (timerId: string | null) => void;
  readonly fire: (timerId: string) => readonly ArmedTimer[];
  readonly disarmAll: () => void;
  readonly timers: () => RunState['timers'];
}

interface CallRequest {
  readonly key: CallKey;
  readonly function: string;
  readonly arguments: Json;
}

interface OpenCall {
  readonly key: CallKey;
  readonly deadline: string;
}

export interface CallTable {
  readonly startCall: (request: CallRequest) => string;
  readonly answerCall: (call: OpenCall) => void;
  readonly cancelCall: (call: OpenCall, reason: CancelReason) => void;
  readonly cancelAll: (reason: CancelReason) => void;
  readonly calls: () => RunState['calls'];
}

export interface ListenerTable {
  readonly arm: (key: CallKey, filters: readonly JsonObject[]) => void;
  readonly cancel: (key: CallKey) => void;
  readonly cancelAll: () => void;
  readonly listeners: () => RunState['listeners'];
}

export function timerTableOf(
  state: RunState,
  run: Pick<Descriptors, 'runId'>,
  now: number,
  journal: Journal,
): TimerTable {
  const armed: Record<string, ArmedTimer> = { ...state.timers.armed };
  const counter = { next: state.timers.next };
  const disarm = (timerId: string | null): void => {
    if (timerId !== null && Object.hasOwn(armed, timerId)) {
      delete armed[timerId];
      journal.emit({ kind: 'cancel_timer', runId: run.runId(), timerId });
    }
  };
  return {
    arm: ({ purpose, reference, milliseconds, label }) => {
      const timerId = String(counter.next);
      counter.next += 1;
      const dueAt = now + milliseconds;
      armed[timerId] = { purpose, reference, armedAt: now, dueAt };
      journal.emit({ kind: 'arm_timer', runId: run.runId(), timerId, dueAt, purpose, label });
      return timerId;
    },
    disarm,
    fire: (timerId) => {
      const fired = Object.entries(armed).filter(([id]: readonly [string, ArmedTimer]) => id === timerId);
      delete armed[timerId];
      return fired.map(([, timer]: readonly [string, ArmedTimer]) => timer);
    },
    disarmAll: () => {
      for (const timerId of Object.keys(armed)) {
        disarm(timerId);
      }
    },
    timers: () => ({ next: counter.next, armed }),
  };
}

interface CallDeadline {
  readonly reference: string;
  readonly now: number;
}

function longestOf(run: Pick<Descriptors, 'limits' | 'startedAt'>, { reference, now }: CallDeadline): number {
  const { longestCallMs, longestCallMsByTask = {}, mostDurationMs } = run.limits();
  const longest = Object.hasOwn(longestCallMsByTask, reference) ? longestCallMsByTask[reference] : undefined;
  return Math.max(1, Math.min(longest ?? longestCallMs, run.startedAt() + mostDurationMs - now));
}

interface CallTableParts {
  readonly timers: TimerTable;
  readonly journal: Journal;
  readonly now: number;
}

export function callTableOf(
  state: RunState,
  run: Pick<Descriptors, 'limits' | 'startedAt'>,
  { timers, journal, now }: CallTableParts,
): CallTable {
  const calls: Record<string, CallKey> = { ...state.calls };
  const close = (key: CallKey): boolean => {
    const text = callKeyText(key);
    const open = Object.hasOwn(calls, text);
    delete calls[text];
    return open;
  };
  const cancel = (key: CallKey, reason: CancelReason): void => {
    if (close(key)) {
      journal.emit({ kind: 'cancel_call', key, reason });
    }
  };
  return {
    startCall: ({ key, function: name, arguments: given }) => {
      calls[callKeyText(key)] = key;
      const longestMs = longestOf(run, { reference: key.reference, now });
      journal.emit({ kind: 'start_call', key, function: name, arguments: given, longestMs });
      const label = `${key.reference} deadline`;
      return timers.arm({ purpose: 'call_deadline', reference: key.reference, milliseconds: longestMs, label });
    },
    answerCall: ({ key, deadline }) => {
      close(key);
      timers.disarm(deadline);
    },
    cancelCall: ({ key, deadline }, reason) => {
      cancel(key, reason);
      timers.disarm(deadline);
    },
    cancelAll: (reason) => {
      for (const key of Object.values(calls)) {
        cancel(key, reason);
      }
    },
    calls: () => calls,
  };
}

export function listenerTableOf(state: RunState, journal: Journal): ListenerTable {
  const armed: Record<string, CallKey> = { ...state.listeners };
  const cancel = (key: CallKey): void => {
    const text = callKeyText(key);
    if (Object.hasOwn(armed, text)) {
      delete armed[text];
      journal.emit({ kind: 'cancel_listener', key });
    }
  };
  return {
    arm: (key, filters) => {
      const text = callKeyText(key);
      if (!Object.hasOwn(armed, text)) {
        armed[text] = key;
        journal.emit({ kind: 'arm_listener', key, filters: [...filters] });
      }
    },
    cancel,
    cancelAll: () => {
      for (const key of Object.values(armed)) {
        cancel(key);
      }
    },
    listeners: () => armed,
  };
}
