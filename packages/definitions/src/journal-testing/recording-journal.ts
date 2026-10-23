import { Conflict, RunCancelled } from '@on.auto/operations';
import { Effect, Option, Result, Struct } from 'effect';

import type { CallFact, RecordedCall, RunAttempt, RunJournal } from '../index.ts';
import {
  isCallStart,
  numberedCall,
  numberingAfter,
  numberingFrom,
  type CallNumbering,
} from '../journal/call-numbering.ts';
import { toolEnded } from '../journal/run-journal.ts';
import type { RecordedCallFact } from '../runs/run-events.ts';
import { recordedOnTheRun } from '../testing/run-facts.ts';

type Journalled<Fact> = Fact extends { readonly type: infer Type; readonly data: infer Data }
  ? { readonly number: number; readonly type: Type; readonly data: Omit<Data, 'number'> }
  : never;

type JournalledFact = Journalled<RecordedCallFact>;

export interface RecordingJournal extends RunJournal {
  readonly recorded: () => readonly JournalledFact[];
  readonly calls: () => readonly RecordedCall[];
}

type Refusing = (fact: CallFact) => boolean;

function refusingNothing(): boolean {
  return false;
}

const refused = new Conflict({ detail: 'The journal of the test refuses this fact', kind: 'taken' });

function numbered<Type extends CallFact['type'], Data extends { readonly number: number }>(
  type: Type,
  data: Data,
): { readonly number: number; readonly type: Type; readonly data: Omit<Data, 'number'> } {
  return { number: data.number, type, data: Struct.omit(data, ['number']) };
}

function entryOf(fact: RecordedCallFact): JournalledFact {
  if (fact.type === 'tool_call_started') {
    return numbered(fact.type, fact.data);
  }
  if (fact.type === 'tool_call_answered') {
    return numbered(fact.type, fact.data);
  }
  if (fact.type === 'tool_call_failed') {
    return numbered(fact.type, fact.data);
  }
  if (fact.type === 'model_call_started') {
    return numbered(fact.type, fact.data);
  }
  return fact.type === 'model_call_answered' ? numbered(fact.type, fact.data) : numbered(fact.type, fact.data);
}

function numberingOf({ modelCallsBefore, calls }: RunAttempt): CallNumbering {
  return calls.reduce<CallNumbering>(
    (numbering, call) => numberingAfter(numbering, call),
    numberingFrom(0, modelCallsBefore),
  );
}

export function recordingJournal(refusing: Refusing = refusingNothing, before?: RunAttempt): RecordingJournal {
  const attempt = before ?? { startedAt: new Date().toISOString(), modelCallsBefore: 0, calls: [] };
  const facts: JournalledFact[] = [];
  const recordedCalls: RecordedCall[] = [];
  const kept = { numbering: numberingOf(attempt) };
  const taken = (fact: CallFact): Effect.Effect<number, Conflict> => {
    const decided = numberedCall(kept.numbering, fact);
    if (Result.isFailure(decided)) {
      return Effect.fail(decided.failure);
    }
    const recorded = decided.success;
    kept.numbering = numberingAfter(kept.numbering, recorded);
    facts.push(entryOf(recorded));
    recordedCalls.push(recordedOnTheRun(recorded));
    return Effect.succeed(recorded.data.number);
  };
  const record = (fact: CallFact) => Effect.suspend(() => (refusing(fact) ? Effect.fail(refused) : taken(fact)));
  return {
    attempt,
    started: (data) => Effect.map(Effect.option(record({ type: 'tool_call_started', data })), Option.getOrUndefined),
    ended: (number, fact) =>
      Effect.match(record(toolEnded(number, fact)), { onFailure: () => false, onSuccess: () => true }),
    record,
    recorded: () => [...facts],
    calls: () => [...recordedCalls],
  };
}

export const cancelledByAnother = new RunCancelled({ detail: 'Not needed any more', kind: 'requested' });

export function cancelledAfter(journal: RecordingJournal, recorded: number): RecordingJournal {
  return {
    ...journal,
    record: (fact) =>
      Effect.suspend(() =>
        journal.recorded().length >= recorded && isCallStart(fact)
          ? Effect.fail(cancelledByAnother)
          : journal.record(fact),
      ),
  };
}
