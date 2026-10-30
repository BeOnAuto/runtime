import { Effect } from 'effect';

import type { CallerContext } from '../access/caller-context.ts';
import type { CallEnded, CallStarted } from '../calls/call-facts.ts';
import { runIdKey } from '../calls/call-meta.ts';
import type { CallJournal } from '../calls/recorded-calls.ts';
import type { CallSignals } from '../calls/run-parts.ts';

export const toolRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

type JournalledFact =
  | { readonly number: number; readonly type: 'tool_call_started'; readonly data: CallStarted }
  | (CallEnded & { readonly number: number });

export interface RecordingCallJournal extends CallJournal {
  readonly facts: () => readonly JournalledFact[];
  readonly refuseStartsFromNowOn: () => void;
}

export interface ControlledSignals extends CallSignals {
  readonly end: () => void;
  readonly cancel: () => void;
}

export function inTurn<A, B>(items: readonly A[], step: (item: A) => Promise<B>): Promise<readonly B[]> {
  return items.reduce<Promise<readonly B[]>>(
    async (done, item) => [...(await done), await step(item)],
    Promise.resolve([]),
  );
}

export function recordingCallJournal(): RecordingCallJournal {
  const facts: JournalledFact[] = [];
  const state = { refusing: false, last: 0 };
  const numbered = (data: CallStarted): number => {
    state.last += 1;
    facts.push({ number: state.last, type: 'tool_call_started', data });
    return state.last;
  };
  return {
    started: (fact) => Effect.sync(() => (state.refusing ? undefined : numbered(fact))),
    ended: (number, fact) =>
      Effect.sync(() => {
        facts.push({ ...fact, number });
        return true;
      }),
    facts: () => [...facts],
    refuseStartsFromNowOn: () => {
      state.refusing = true;
    },
  };
}

export function toolRun(journal: CallJournal, changes: Partial<Omit<CallerContext, 'journal'>> = {}): CallerContext {
  return { id: toolRunId, org: 'acme', playbook: 'alpha', meta: { [runIdKey]: toolRunId }, ...changes, journal };
}

export function controlledSignals(): ControlledSignals {
  const ended = new AbortController();
  const cancelled = new AbortController();
  return {
    signal: AbortSignal.any([ended.signal, cancelled.signal]),
    cancelled: cancelled.signal,
    end: () => {
      ended.abort();
    },
    cancel: () => {
      cancelled.abort();
    },
  };
}
