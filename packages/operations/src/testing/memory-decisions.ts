import { Clock, Effect, Result } from 'effect';

import {
  Conflict,
  checkedContext,
  noLineage,
  recordingOf,
  type DecidedState,
  type Decider,
  type DeclarableReason,
  type Ledger,
  type Lineage,
  type Recorded,
  type Rejection,
  type StreamDecision,
} from '../index.ts';
import { appendedTo, storedIn, type Appended, type Kept } from './memory-appends.ts';
import { encodedWith, folded, foldedOver, payloadsHeaded, requireHeldAsMeasured } from './memory-payloads.ts';

interface DecidedOnAStream<State> extends DecidedState<State> {
  readonly stream: string;
  readonly loaded: number;
  readonly appended?: Appended;
}

const changedWhileDeciding = new Conflict({
  detail: 'The state changed while the command was decided',
  kind: 'concurrent_change',
});

function decidedOn<State, Command, Event extends Recorded, R extends DeclarableReason>(
  kept: Kept,
  { stream, decider, command }: StreamDecision<State, Command, Event, R>,
  lineage: Lineage,
): Effect.Effect<DecidedOnAStream<State>, Rejection<R>> {
  return Effect.gen(function* () {
    const { state, version } = yield* folded(decider, storedIn(kept, stream));
    yield* Effect.yieldNow;
    const decided = decider.decide(command, state);
    if (Result.isFailure(decided)) {
      return yield* Effect.fail(decided.failure);
    }
    if (decided.success.length === 0) {
      return { state, version, decidedOn: state, stream, loaded: version };
    }
    const context = yield* Effect.sync(() => checkedContext(decider.context(command, state)));
    const events = yield* Effect.sync(() =>
      decided.success.map((event) => recordingOf(decider.eventSchema)(event, context)),
    );
    const stored = yield* Effect.forEach(events, encodedWith(decider.eventSchema, context));
    yield* Effect.sync(() => {
      requireHeldAsMeasured(kept.holders, stream, stored);
    });
    yield* payloadsHeaded(kept.heads, kept.holders, stream, stored);
    const after = foldedOver(decider, state, events);
    const appended = { stream, stored, lineage };
    return { state: after, version: version + events.length, decidedOn: state, stream, loaded: version, appended };
  });
}

function isStill(kept: Kept, { stream, loaded }: DecidedOnAStream<unknown>): boolean {
  return storedIn(kept, stream).length === loaded;
}

function keptAll<State>(
  kept: Kept,
  decided: readonly DecidedOnAStream<State>[],
): Effect.Effect<readonly DecidedState<State>[], Conflict> {
  return Effect.gen(function* () {
    if (!decided.every((each: DecidedOnAStream<State>) => isStill(kept, each))) {
      return yield* Effect.fail(changedWhileDeciding);
    }
    const appends = decided.flatMap(({ appended }) => (appended === undefined ? [] : [appended]));
    const refused = appends.length === 0 ? undefined : appendedTo(kept, appends, yield* Clock.currentTimeMillis);
    if (refused !== undefined) {
      return yield* Effect.fail(refused);
    }
    return decided.map(({ state, version, decidedOn: on }) => ({ state, version, decidedOn: on }));
  });
}

export function executedOn(kept: Kept): Ledger['Service']['execute'] {
  return <State, Command, Event extends Recorded, R extends DeclarableReason>(
    stream: string,
    decider: Decider<State, Command, Event, R>,
    command: Command,
    lineage = noLineage,
  ) =>
    Effect.flatMap(decidedOn(kept, { stream, decider, command }, lineage), (decided) =>
      Effect.map(keptAll(kept, [decided]), ([only = decided]) => only),
    );
}

export function multiStreamExecutedOn(kept: Kept): Ledger['Service']['executeMultiStream'] {
  return <State, Command, Event extends Recorded, R extends DeclarableReason>(
    decisions: readonly StreamDecision<State, Command, Event, R>[],
    lineage: Lineage = noLineage,
  ) =>
    Effect.flatMap(
      Effect.forEach(decisions, (decision) => decidedOn(kept, decision, lineage)),
      (decided: readonly DecidedOnAStream<State>[]) => keptAll(kept, decided),
    );
}
