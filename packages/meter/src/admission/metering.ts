import type { MeteredRun } from '@on.auto/definitions';
import { UnreadableEvent, type LogPorts } from '@on.auto/ledger';
import { Conflict, streamPrefixOfPlaybook, Unavailable, type Ledger } from '@on.auto/operations';
import { DateTime, Effect } from 'effect';

import { digestOf } from '../counting/checkpoint-digest.ts';
import { firstStartIn } from '../counting/first-starts.ts';
import { countedAfter, countedFromTheStart, type Counting } from '../counting/run-starts.ts';
import type { MeterCommand } from '../meter-stream/meter-commands.ts';
import { meterDecider } from '../meter-stream/meter-decider.ts';
import { METER_STREAM, type Fault, type MeterState } from '../meter-stream/meter-events.ts';

export interface MeterOptions {
  readonly allowance: number;
  readonly holdMs: number;
  readonly verifyEvery: number;
  readonly studio: string;
}

export const meterDefaults: MeterOptions = {
  allowance: 100,
  holdMs: 600_000,
  verifyEvery: 1000,
  studio: 'https://studio.on.auto',
};

export interface Metering {
  readonly ledger: Ledger['Service'];
  readonly log: LogPorts;
  readonly options: MeterOptions;
  readonly admissionNumbered: Effect.Effect<number>;
  readonly runtimeIdOf: (state: MeterState) => string | undefined;
}

export const meterUnavailable = new Unavailable({
  detail: 'This runtime could not read its ledger to meter the run, so the run was not started; ask again shortly',
  kind: 'meter_unavailable',
});

export function licensesPageOf({ studio }: MeterOptions, installation: string | undefined): string {
  return installation === undefined ? `${studio}/licenses` : `${studio}/licenses?installation=${installation}`;
}

export function faultRefusal({ detail }: Fault, { options, runtimeIdOf }: Metering, state: MeterState): Conflict {
  const support = `${options.studio}/support`;
  const runtimeId = runtimeIdOf(state);
  const naming = runtimeId === undefined ? '' : ` (runtime id ${runtimeId})`;
  return new Conflict({
    detail: `This runtime stopped starting runs because ${detail}. We need to repair it; see ${support}${naming}. Reading, editing and exporting still work.`,
    kind: 'metering_fault',
    resolve_at: support,
    ...(runtimeId === undefined ? {} : { runtime_id: runtimeId }),
  });
}

export function runStreamOf({ org, playbook, run_id: runId }: MeteredRun): string {
  return `${streamPrefixOfPlaybook({ org, playbook })}runs/${runId.toLowerCase()}`;
}

export function actionOf({ org, playbook, run_id: runId }: MeteredRun): string {
  return `${org}/${playbook}/${runId.toLowerCase()}`;
}

export const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

export const meterStateOf = ({ ledger }: Metering): Effect.Effect<MeterState> =>
  Effect.map(ledger.load(METER_STREAM, meterDecider), ({ state }) => state);

function isConcurrentChange(refusal: unknown): boolean {
  return refusal instanceof Conflict && refusal.kind === 'concurrent_change';
}

export function executed(metering: Metering, command: MeterCommand): Effect.Effect<MeterState, Conflict> {
  return metering.ledger.execute(METER_STREAM, meterDecider, command).pipe(
    Effect.retry({ times: metering.options.allowance * 2, while: isConcurrentChange }),
    Effect.map(({ state }) => state),
  );
}

function faulted(metering: Metering, fault: Fault): Effect.Effect<never, Conflict> {
  return Effect.gen(function* () {
    const command: MeterCommand = { type: 'fault', fault, at: yield* nowIso };
    yield* Effect.ignore(metering.ledger.execute(METER_STREAM, meterDecider, command));
    return yield* faultRefusal(fault, metering, yield* meterStateOf(metering));
  });
}

export function read<A>(metering: Metering, reading: () => Promise<A>): Effect.Effect<A, Conflict | Unavailable> {
  return Effect.tryPromise({
    try: reading,
    catch: (cause) => (cause instanceof UnreadableEvent ? cause : meterUnavailable),
  }).pipe(
    Effect.catchTag('unreadable_event', () =>
      faulted(metering, { reason: 'unreadable', detail: 'an event of its ledger can no longer be read' }),
    ),
  );
}

function firstStartOf({ ledger }: Metering): (stream: string) => Promise<number | undefined> {
  return (stream) => Effect.runPromise(firstStartIn(ledger, stream));
}

function rebuilt(metering: Metering, why: string): Effect.Effect<Counting, Conflict | Unavailable> {
  return Effect.logWarning(`The meter counted its ledger again from the first event: ${why}`).pipe(
    Effect.andThen(read(metering, () => countedFromTheStart(metering.log))),
  );
}

export function caughtUp(metering: Metering, state: MeterState): Effect.Effect<Counting, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const { log } = metering;
    const checkpoint = state.checkpoint;
    if (checkpoint === undefined) return yield* read(metering, () => countedFromTheStart(log));
    if (digestOf(checkpoint) !== checkpoint.digest) return yield* rebuilt(metering, 'its count was edited');
    const standing = yield* read(metering, () => log.at(checkpoint.through));
    if (standing === undefined) {
      return yield* faulted(metering, {
        reason: 'history_removed',
        detail: 'the event its meter counted last is no longer in its ledger',
      });
    }
    if (standing.id !== checkpoint.last) {
      return yield* faulted(metering, {
        reason: 'history_rewritten',
        detail: 'another event stands where its meter counted its last',
      });
    }
    return yield* read(metering, () => countedAfter(log, firstStartOf(metering), checkpoint));
  });
}

export function verified(metering: Metering, counting: Counting): Effect.Effect<Counting, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const recounted = yield* read(metering, () => countedFromTheStart(metering.log));
    if (recounted.actions < counting.actions) {
      return yield* faulted(metering, {
        reason: 'history_removed',
        detail: `its ledger holds ${recounted.actions} of the ${counting.actions} actions its meter counted`,
      });
    }
    if (recounted.actions > counting.actions) {
      yield* Effect.logWarning(
        `The meter's count of ${counting.actions} actions was edited; its ledger holds ${recounted.actions}`,
      );
    }
    return recounted;
  });
}

export function counted(metering: Metering, state: MeterState): Effect.Effect<Counting, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const counting = yield* caughtUp(metering, state);
    const admission = yield* metering.admissionNumbered;
    return admission % metering.options.verifyEvery === 0 ? yield* verified(metering, counting) : counting;
  });
}

export function checkpointed(metering: Metering, counting: Counting): Effect.Effect<void> {
  return Effect.ignore(Effect.flatMap(nowIso, (at) => executed(metering, { type: 'count', counting, at })));
}

export function startedVerified(metering: Metering): Effect.Effect<void> {
  return Effect.ignore(
    Effect.gen(function* () {
      const state = yield* meterStateOf(metering);
      if (state.fault !== undefined) return;
      yield* checkpointed(metering, yield* verified(metering, yield* caughtUp(metering, state)));
    }),
  );
}

export function hasStarted({ ledger }: Metering, run: MeteredRun): Effect.Effect<boolean> {
  return Effect.map(firstStartIn(ledger, runStreamOf(run)), (first) => first !== undefined);
}
