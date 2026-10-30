import type { CallResult } from '@on.auto/operations';

import type { CancelCall, StartCall } from '../dispatch/run-output.ts';
import { callKeyText, type CallKey } from '../executor/call-key.ts';
import type { CallCancelReceipt, Executor, StartReceipt } from '../executor/executor.ts';
import type { Faults, Submit } from './memory-timers.ts';
import type { VirtualClock } from './virtual-clock.ts';

export type CallAnswer =
  | { readonly after?: number; readonly result: CallResult }
  | { readonly later: Promise<CallResult> }
  | 'never';

export type Responder = (call: StartCall) => CallAnswer;

export interface MemoryExecutor extends Executor {
  readonly lose: (key: CallKey) => void;
  readonly cancelled: () => readonly CancelCall[];
}

interface CallBook {
  readonly answered: ReadonlyMap<string, CallResult>;
  readonly isRunning: (key: string) => boolean;
  readonly answerAgain: (call: StartCall, result: CallResult) => void;
  readonly begin: (call: StartCall) => StartReceipt;
  readonly forget: (key: string) => boolean;
  readonly lose: (key: string) => void;
}

function callBookOf(clock: VirtualClock, submit: Submit, responder: Responder): CallBook {
  const answered = new Map<string, CallResult>();
  const started = new Set<string>();
  const awaited = new Set<string>();
  const answer = (call: StartCall, result: CallResult): CallResult => {
    const key = callKeyText(call.key);
    awaited.delete(key);
    answered.set(key, result);
    submit({ kind: 'call_answered', runId: call.key.runId, at: clock.now(), key: call.key, result });
    return result;
  };
  const reply = (call: StartCall, key: string, given: Exclude<CallAnswer, 'never'>): void => {
    if ('later' in given) {
      awaited.add(key);
      void given.later.then((result) => answer(call, result));
      return;
    }
    clock.schedule(clock.now() + (given.after ?? 0), key, () => {
      answer(call, given.result);
    });
  };
  return {
    answered,
    isRunning: (key) => clock.has(key) || awaited.has(key),
    answerAgain: (call, result) => {
      reply(call, callKeyText(call.key), { result });
    },
    begin: (call) => {
      const key = callKeyText(call.key);
      const again = started.has(key);
      started.add(key);
      const given = responder(call);
      if (given !== 'never') {
        reply(call, key, given);
      }
      return again ? 'started_again' : 'started';
    },
    forget: (key) => {
      clock.unschedule(key);
      return started.delete(key);
    },
    lose: (key) => {
      clock.unschedule(key);
      awaited.delete(key);
    },
  };
}

export function memoryExecutor(
  clock: VirtualClock,
  submit: Submit,
  responder: Responder,
  faults: Faults,
): MemoryExecutor {
  const book = callBookOf(clock, submit, responder);
  const tombstones = new Set<string>();
  const cancels: CancelCall[] = [];
  const start = (call: StartCall): StartReceipt => {
    const key = callKeyText(call.key);
    const result = book.answered.get(key);
    if (tombstones.has(key)) {
      return 'refused_after_cancel';
    }
    if (result !== undefined) {
      book.answerAgain(call, result);
      return 'answered_again';
    }
    return book.isRunning(key) ? 'running' : book.begin(call);
  };
  const cancel = (key: string): CallCancelReceipt => {
    if (book.answered.has(key)) {
      return 'already_answered';
    }
    tombstones.add(key);
    return book.forget(key) ? 'cancelled' : 'tombstoned';
  };
  return {
    start: (call) => faults.attempt(call, () => start(call)),
    cancel: (call) =>
      faults.attempt(call, () => {
        cancels.push(call);
        return cancel(callKeyText(call.key));
      }),
    lose: (key) => {
      book.lose(callKeyText(key));
    },
    cancelled: () => [...cancels],
  };
}
