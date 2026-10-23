import { Conflict } from '@on.auto/operations';
import { Effect, Option, Struct } from 'effect';

import type { CallFact, RunJournal } from '../index.ts';
import { toolEnded } from '../journal/run-journal.ts';

type Journalled<Fact> = Fact extends { readonly type: infer Type; readonly data: infer Data }
  ? { readonly number: number; readonly type: Type; readonly data: Omit<Data, 'number'> }
  : never;

type JournalledFact = Journalled<CallFact>;

export interface RecordingJournal extends RunJournal {
  readonly recorded: () => readonly JournalledFact[];
}

type Refusing = (fact: CallFact) => boolean;

function refusingNothing(): boolean {
  return false;
}

const refused = new Conflict({ detail: 'The journal of the test refuses this fact', kind: 'taken' });

function notTheNext(number: number): Conflict {
  return new Conflict({ detail: `Model call ${number} is not the next of the run`, kind: 'taken' });
}

function numbered<Type extends CallFact['type'], Data extends { readonly number: number }>(
  type: Type,
  data: Data,
): { readonly number: number; readonly type: Type; readonly data: Omit<Data, 'number'> } {
  return { number: data.number, type, data: Struct.omit(data, ['number']) };
}

function entryOf(fact: Exclude<CallFact, { readonly type: 'tool_call_started' }>): JournalledFact {
  if (fact.type === 'tool_call_answered') {
    return numbered(fact.type, fact.data);
  }
  if (fact.type === 'tool_call_failed') {
    return numbered(fact.type, fact.data);
  }
  if (fact.type === 'model_call_started') {
    return numbered(fact.type, fact.data);
  }
  if (fact.type === 'model_call_answered') {
    return numbered(fact.type, fact.data);
  }
  return numbered(fact.type, fact.data);
}

export function recordingJournal(refusing: Refusing = refusingNothing, modelCallsBefore = 0): RecordingJournal {
  const facts: JournalledFact[] = [];
  const calls = { last: 0, lastModel: modelCallsBefore };
  const taken = (fact: CallFact): Effect.Effect<number, Conflict> => {
    if (fact.type === 'tool_call_started') {
      calls.last += 1;
      facts.push({ number: calls.last, type: fact.type, data: fact.data });
      return Effect.succeed(calls.last);
    }
    if (fact.type === 'model_call_started') {
      if (fact.data.number !== calls.lastModel + 1) {
        return Effect.fail(notTheNext(fact.data.number));
      }
      calls.lastModel = fact.data.number;
    }
    facts.push(entryOf(fact));
    return Effect.succeed(fact.data.number);
  };
  const record = (fact: CallFact) => Effect.suspend(() => (refusing(fact) ? Effect.fail(refused) : taken(fact)));
  return {
    modelCallsBefore,
    started: (data) => Effect.map(Effect.option(record({ type: 'tool_call_started', data })), Option.getOrUndefined),
    ended: (number, fact) =>
      Effect.match(record(toolEnded(number, fact)), { onFailure: () => false, onSuccess: () => true }),
    record,
    recorded: () => [...facts],
  };
}
