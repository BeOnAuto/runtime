import {
  Conflict,
  PlaybookContext,
  PlaybookWriter,
  Caller,
  messageIdOf,
  streamPrefixOfPlaybook,
} from '@on.auto/operations';
import type { CallEnded } from '@on.auto/tool-servers';
import { DateTime, Effect, Exit, Ref, Schema, Semaphore } from 'effect';

import type { RunAttempt, RunJournal, RunLineage } from '../capability/run-context.ts';
import type { CallFact } from '../runs/run-commands.ts';
import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import type { ToolCallEnded } from '../runs/run-events.ts';
import { lastCallOf, startedRunOf, type RunState } from '../runs/run-state.ts';
import { isCallStart } from './call-numbering.ts';

export interface LedgerJournal extends RunJournal {
  readonly latest: Effect.Effect<string>;
}

interface Calls {
  readonly answered: string;
  readonly started: ReadonlyMap<string, string>;
}

function keyOf({ type }: CallFact, number: number): string {
  return `${type.startsWith('model_call') ? 'model' : 'tool'}/${number}`;
}

function numberOf(fact: CallFact, state: RunState): number {
  return fact.type === 'tool_call_started' ? lastCallOf(state) : fact.data.number;
}

function causeOf(fact: CallFact, calls: Calls): string {
  return isCallStart(fact) ? calls.answered : (calls.started.get(keyOf(fact, fact.data.number)) ?? calls.answered);
}

function noted(fact: CallFact, calls: Calls, number: number, id: string): Calls {
  return isCallStart(fact)
    ? { ...calls, started: new Map([...calls.started, [keyOf(fact, number), id]]) }
    : { ...calls, answered: id };
}

export function toolEnded(number: number, fact: CallEnded): ToolCallEnded {
  return fact.type === 'tool_call_answered'
    ? { type: fact.type, data: { number, ...fact.data } }
    : { type: fact.type, data: { number, ...fact.data } };
}

function recorded<A, E>(appended: Effect.Effect<A, E>): Effect.Effect<boolean> {
  return appended.pipe(Effect.exit, Effect.map(Exit.isSuccess));
}

const changedMeanwhile = new Conflict({
  detail: 'The run changed while this attempt recorded a call, so this attempt does not go on with it',
  kind: 'taken',
});

const isChangedWhileRecorded = Schema.is(Schema.Struct({ kind: Schema.Literal('concurrent_change') }));

export const runJournal = Effect.fnUntraced(function* (id: string, lineage: RunLineage, attempt: RunAttempt) {
  const writer = yield* PlaybookWriter;
  const stream = `${streamPrefixOfPlaybook(yield* PlaybookContext)}${runStreamNameOf(id)}`;
  const { id: by } = yield* Caller;
  const permit = yield* Semaphore.make(1);
  const calls = yield* Ref.make<Calls>({ answered: lineage.startId, started: new Map() });
  const record = (fact: CallFact) =>
    permit.withPermits(1)(
      Effect.gen(function* () {
        const at = DateTime.formatIso(yield* DateTime.now);
        const known = yield* Ref.get(calls);
        const { state, version } = yield* writer
          .execute(
            runStreamNameOf(id),
            runDecider,
            { type: 'call', fact, runId: id, by, at },
            { causationId: causeOf(fact, known), correlationId: lineage.correlationId },
          )
          .pipe(
            Effect.catchTag('not_found', Effect.die),
            Effect.catchIf(isChangedWhileRecorded, () => Effect.fail(changedMeanwhile)),
          );
        const number = numberOf(fact, startedRunOf(state));
        yield* Ref.set(calls, noted(fact, known, number, messageIdOf(stream, version)));
        return number;
      }),
    );
  const journal: LedgerJournal = {
    attempt,
    started: (data) => record({ type: 'tool_call_started', data }).pipe(Effect.catchCause(() => Effect.undefined)),
    ended: (number, fact) => recorded(record(toolEnded(number, fact))),
    record,
    latest: Effect.map(Ref.get(calls), ({ answered }) => answered),
  };
  return journal;
});
