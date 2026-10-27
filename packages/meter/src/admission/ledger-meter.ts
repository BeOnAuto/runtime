import { RunMeter, type Meter, type MeteredRun } from '@on.auto/definitions';
import { LedgerLog, UnreadableEvent, type LogPorts } from '@on.auto/ledger';
import { Conflict, Ledger, randomUUIDv7, streamPrefixOfPlaybook, Unavailable } from '@on.auto/operations';
import { DateTime, Effect, Layer, Ref } from 'effect';

import { digestOf } from '../counting/checkpoint-digest.ts';
import { firstStartIn } from '../counting/first-starts.ts';
import { countedAfter, countedFromTheStart, type Counting } from '../counting/run-starts.ts';
import { meterDecider, type MeterCommand } from '../meter-stream/meter-decider.ts';
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

const meterUnavailable = new Unavailable({
  detail: 'This runtime could not read its ledger to meter the run, so the run was not started; ask again shortly',
  kind: 'meter_unavailable',
});

function faultRefusal({ detail }: Fault, { studio }: MeterOptions): Conflict {
  return new Conflict({
    detail: `This runtime stopped starting runs: ${detail}. Nothing new runs until Auto repairs its meter; reach Auto at ${studio}/support`,
    kind: 'metering_fault',
  });
}

function licenseRefusal({ allowance, studio }: MeterOptions): (installation: string) => string {
  return (installation) =>
    `This runtime has run the ${allowance} actions it may before it is registered. Register it at ${studio}/licenses?installation=${installation}, where an org gets its key for free, and activate it with that key`;
}

function runStreamOf({ org, playbook, run_id: runId }: MeteredRun): string {
  return `${streamPrefixOfPlaybook({ org, playbook })}runs/${runId.toLowerCase()}`;
}

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

interface Metering {
  readonly ledger: Ledger['Service'];
  readonly log: LogPorts;
  readonly options: MeterOptions;
  readonly admissionNumbered: Effect.Effect<number>;
}

function isConcurrentChange(refusal: unknown): boolean {
  return refusal instanceof Conflict && refusal.kind === 'concurrent_change';
}

function isNotALicenseRefusal(refusal: unknown): boolean {
  return !(refusal instanceof Conflict && refusal.kind === 'license_required');
}

function faulted(metering: Metering, fault: Fault): Effect.Effect<never, Conflict> {
  return Effect.gen(function* () {
    const command: MeterCommand = { type: 'fault', fault, at: yield* nowIso };
    yield* Effect.ignore(metering.ledger.execute(METER_STREAM, meterDecider, command));
    return yield* faultRefusal(fault, metering.options);
  });
}

function read<A>(metering: Metering, reading: () => Promise<A>): Effect.Effect<A, Conflict | Unavailable> {
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

function caughtUp(metering: Metering, state: MeterState): Effect.Effect<Counting, Conflict | Unavailable> {
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

function verified(metering: Metering, counting: Counting): Effect.Effect<Counting, Conflict | Unavailable> {
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

function counted(metering: Metering, state: MeterState): Effect.Effect<Counting, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const counting = yield* caughtUp(metering, state);
    const admission = yield* metering.admissionNumbered;
    return admission % metering.options.verifyEvery === 0 ? yield* verified(metering, counting) : counting;
  });
}

function admitting(run: MeteredRun, counting: Counting, at: string, options: MeterOptions): MeterCommand {
  return {
    type: 'admit',
    run: runStreamOf(run),
    counting,
    allowance: options.allowance,
    at,
    until: DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(at), { milliseconds: options.holdMs })),
    installation: randomUUIDv7(),
    refusal: licenseRefusal(options),
  };
}

function admitted(metering: Metering, run: MeteredRun): Effect.Effect<void, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const { ledger, options } = metering;
    const { state } = yield* ledger.load(METER_STREAM, meterDecider);
    if (state.fault !== undefined) return yield* faultRefusal(state.fault, options);
    const counting = yield* counted(metering, state);
    if ((yield* firstStartIn(ledger, runStreamOf(run))) !== undefined) return yield* Effect.void;
    const command = admitting(run, counting, yield* nowIso, options);
    return yield* ledger.execute(METER_STREAM, meterDecider, command).pipe(
      Effect.retry({ times: options.allowance * 2, while: isConcurrentChange }),
      Effect.catchIf(isNotALicenseRefusal, () => Effect.fail(meterUnavailable)),
      Effect.asVoid,
    );
  }).pipe(Effect.catchDefect(() => Effect.fail(meterUnavailable)));
}

function startedVerified(metering: Metering): Effect.Effect<void> {
  return Effect.ignore(
    Effect.gen(function* () {
      const { state } = yield* metering.ledger.load(METER_STREAM, meterDecider);
      if (state.fault !== undefined) return;
      const counting = yield* verified(metering, yield* caughtUp(metering, state));
      const command: MeterCommand = { type: 'count', counting, at: yield* nowIso };
      yield* metering.ledger.execute(METER_STREAM, meterDecider, command);
    }),
  );
}

export interface MeteredLedger {
  readonly ledger: Ledger['Service'];
  readonly log: LogPorts;
}

export function meterOver({ ledger, log }: MeteredLedger, options: MeterOptions): Effect.Effect<Meter> {
  return Effect.gen(function* () {
    const admissions = yield* Ref.make(0);
    const admissionNumbered = Ref.updateAndGet(admissions, (count) => count + 1);
    const metering: Metering = { ledger, log, options, admissionNumbered };
    yield* startedVerified(metering);
    return { admit: (run) => admitted(metering, run) };
  });
}

export function ledgerMeter(options: MeterOptions = meterDefaults): Layer.Layer<RunMeter, never, Ledger | LedgerLog> {
  return Layer.effect(
    RunMeter,
    Effect.gen(function* () {
      return RunMeter.of(yield* meterOver({ ledger: yield* Ledger, log: yield* LedgerLog }, options));
    }),
  );
}
