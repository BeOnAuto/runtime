import { PlaybookContext, PlaybookWriter, Caller, messageIdOf, streamPrefixOfPlaybook } from '@on.auto/operations';
import type { CallEnded } from '@on.auto/tool-servers';
import { DateTime, Effect, Exit, Ref, Semaphore } from 'effect';

import type { RunJournal, RunLineage } from '../capability/capability.ts';
import type { CallFact } from '../runs/run-commands.ts';
import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import { lastCallOf, lastModelCallOf, startedRunOf, type RunState } from '../runs/run-state.ts';

export interface LedgerJournal extends RunJournal {
  readonly latest: Effect.Effect<string>;
}

interface Calls {
  readonly answered: string;
  readonly started: ReadonlyMap<string, string>;
}

function isStart({ type }: CallFact): boolean {
  return type === 'tool_call_started' || type === 'model_call_started';
}

function keyOf({ type }: CallFact, number: number): string {
  return `${type.startsWith('model_call') ? 'model' : 'tool'}/${number}`;
}

function numberOf(fact: CallFact, state: RunState): number {
  return fact.type === 'tool_call_started' ? lastCallOf(state) : fact.data.number;
}

function causeOf(fact: CallFact, calls: Calls): string {
  if (fact.type === 'tool_call_started' || fact.type === 'model_call_started') {
    return calls.answered;
  }
  return calls.started.get(keyOf(fact, fact.data.number)) ?? calls.answered;
}

function noted(fact: CallFact, calls: Calls, number: number, id: string): Calls {
  return isStart(fact)
    ? { ...calls, started: new Map([...calls.started, [keyOf(fact, number), id]]) }
    : { ...calls, answered: id };
}

export function toolEnded(number: number, fact: CallEnded): CallFact {
  return fact.type === 'tool_call_answered'
    ? { type: fact.type, data: { number, ...fact.data } }
    : { type: fact.type, data: { number, ...fact.data } };
}

function recorded<A, E>(appended: Effect.Effect<A, E>): Effect.Effect<boolean> {
  return appended.pipe(Effect.exit, Effect.map(Exit.isSuccess));
}

export const runJournal = Effect.fnUntraced(function* (id: string, lineage: RunLineage, started: RunState) {
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
        const { state, version } = yield* writer.execute(
          runStreamNameOf(id),
          runDecider,
          { type: 'call', fact, runId: id, by, at },
          { causationId: causeOf(fact, known), correlationId: lineage.correlationId },
        );
        const number = numberOf(fact, startedRunOf(state));
        yield* Ref.set(calls, noted(fact, known, number, messageIdOf(stream, version)));
        return number;
      }),
    );
  const journal: LedgerJournal = {
    modelCallsBefore: lastModelCallOf(started),
    started: (data) => record({ type: 'tool_call_started', data }).pipe(Effect.catchCause(() => Effect.undefined)),
    ended: (number, fact) => recorded(record(toolEnded(number, fact))),
    record,
    latest: Effect.map(Ref.get(calls), ({ answered }) => answered),
  };
  return journal;
});
