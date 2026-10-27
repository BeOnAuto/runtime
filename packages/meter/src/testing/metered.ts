import type { Meter, MeteredRun } from '@on.auto/definitions';
import { LedgerLog, type LogPorts } from '@on.auto/ledger';
import { ActedContextSchema, Conflict, Ledger, type Decider } from '@on.auto/operations';
import { DateTime, Effect, Layer, Logger, ManagedRuntime, Result, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import { meterDefaults, meterOver, type MeterOptions } from '../admission/ledger-meter.ts';
import { meterDecider } from '../meter-stream/meter-decider.ts';
import { METER_STREAM, type MeterState } from '../meter-stream/meter-events.ts';
import type { LedgerAt } from './ledgers.ts';

const FIRST_MOMENT = '2026-10-27T12:00:00.000Z';

const AppendedSchema = Schema.Struct({
  type: Schema.Literals(['run_started', 'noted']),
  data: Schema.Struct({}),
  context: ActedContextSchema,
});

type Appended = typeof AppendedSchema.Type;

function appending(type: Appended['type'], count: number): Decider<number, null, Appended> {
  return {
    initialState: 0,
    evolve: (seen) => seen + 1,
    eventSchema: AppendedSchema,
    decide: () => Result.succeed(Array.from({ length: count }, () => ({ type, data: {} }))),
    context: () => ({ at: FIRST_MOMENT, by: 'tester' }),
  };
}

const starts = appending('run_started', 1);

export function runOf(run: string, playbook = 'alpha', org = 'acme'): MeteredRun {
  return {
    org,
    playbook,
    run_id: run,
    definition_type: 'computation',
    definition_name: 'totals',
    definition_version: 1,
    correlation_id: run,
    called_by: null,
    trigger: null,
    started_by: 'person:ada',
  };
}

export function runStreamOf(run: string, playbook = 'alpha', org = 'acme'): string {
  return `playbook/${org}/${playbook}/runs/${run}`;
}

interface Answer {
  readonly kind: string;
  readonly detail: string;
}

const admittedAnswer: Answer = { kind: 'admitted', detail: '' };

function answerOfRefusal(refusal: unknown): Answer {
  const refused = new Object(refusal);
  return { kind: String(Reflect.get(refused, 'kind')), detail: String(Reflect.get(refused, 'detail')) };
}

export function inTurn<Item, Done>(
  items: readonly Item[],
  work: (item: Item) => Promise<Done>,
): Promise<readonly Done[]> {
  return items.reduce<Promise<readonly Done[]>>(
    async (done, item) => [...(await done), await work(item)],
    Promise.resolve([]),
  );
}

export interface Metered {
  readonly meter: Meter;
  readonly admitted: (run: MeteredRun) => Promise<Answer>;
  readonly started: (run: string, playbook?: string, org?: string) => Promise<void>;
  readonly noted: (stream: string, count: number) => Promise<void>;
  readonly state: () => Promise<MeterState>;
  readonly lastCounted: () => Promise<string>;
  readonly eventsRead: () => number;
  readonly readsFail: () => void;
  readonly executesFail: (failure: 'conflict' | 'defect') => void;
  readonly warnings: () => readonly string[];
  readonly at: (moment: string) => void;
  readonly restarted: (options?: Partial<MeterOptions>) => Promise<Metered>;
  readonly dispose: () => Promise<void>;
}

interface WatchedLog {
  readonly log: (log: LogPorts) => LogPorts;
  readonly eventsRead: () => number;
  readonly readsFail: () => void;
}

function watchedLog(): WatchedLog {
  const watched = { events: 0, failing: false };
  const unless = <A>(read: () => Promise<A>) =>
    watched.failing ? Promise.reject(new Error('The ledger cannot be reached')) : read();
  return {
    log: (log) => ({
      ...log,
      at: (point) => unless(() => log.at(point)),
      after: async (point, most) => {
        const page = await unless(() => log.after(point, most));
        watched.events += page.events.length;
        return page;
      },
    }),
    eventsRead: () => watched.events,
    readsFail: () => {
      watched.failing = true;
    },
  };
}

interface FailingLedger {
  readonly ledger: (ledger: Ledger['Service']) => Ledger['Service'];
  readonly executesFail: (failure: 'conflict' | 'defect') => void;
}

const lostToOthers = new Conflict({ kind: 'concurrent_change', detail: 'Another change came first' });

function failingLedger(): FailingLedger {
  const failing = { with: 'nothing' };
  return {
    ledger: (ledger) => ({
      ...ledger,
      execute: (stream, decider, command, lineage) => {
        if (failing.with === 'conflict') return Effect.fail(lostToOthers);
        if (failing.with === 'defect') return Effect.die(new Error('The ledger broke'));
        return ledger.execute(stream, decider, command, lineage);
      },
    }),
    executesFail: (failure) => {
      failing.with = failure;
    },
  };
}

function capturedWarnings(): { readonly layer: Layer.Layer<never>; readonly lines: () => readonly string[] } {
  const lines: string[] = [];
  const capture = Logger.make(({ message }: { readonly message: unknown }) => {
    lines.push(String(message));
  });
  return { layer: Logger.layer([capture]), lines: () => [...lines] };
}

export async function meteredOn(at: LedgerAt, options: Partial<MeterOptions> = {}): Promise<Metered> {
  const warnings = capturedWarnings();
  const runtime = ManagedRuntime.make(Layer.mergeAll(at.layer(), TestClock.layer(), warnings.layer));
  const watched = watchedLog();
  const failing = failingLedger();
  const moment = { now: FIRST_MOMENT };
  const onTheClock = <A, E>(work: Effect.Effect<A, E, Ledger | LedgerLog>) =>
    TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(moment.now))).pipe(Effect.andThen(work));
  const timed = <A, E>(work: Effect.Effect<A, E, Ledger | LedgerLog>) => runtime.runPromise(onTheClock(work));
  const onTheLedger = <A, E>(work: (ledger: Ledger['Service']) => Effect.Effect<A, E>) =>
    timed(Effect.flatMap(Effect.service(Ledger), work));
  const meter = await timed(
    Effect.gen(function* () {
      const log = watched.log(yield* LedgerLog);
      return yield* meterOver({ ledger: failing.ledger(yield* Ledger), log }, { ...meterDefaults, ...options });
    }),
  );
  const state = async () => (await onTheLedger((ledger) => ledger.load(METER_STREAM, meterDecider))).state;
  return {
    meter,
    admitted: (run) =>
      timed(meter.admit(run).pipe(Effect.match({ onSuccess: () => admittedAnswer, onFailure: answerOfRefusal }))),
    started: async (run, playbook, org) => {
      await onTheLedger((ledger) => ledger.execute(runStreamOf(run, playbook, org), starts, null));
    },
    noted: async (stream, count) => {
      await onTheLedger((ledger) => ledger.execute(stream, appending('noted', count), null));
    },
    state,
    lastCounted: async () => String((await state()).checkpoint?.last),
    eventsRead: watched.eventsRead,
    readsFail: watched.readsFail,
    executesFail: failing.executesFail,
    warnings: warnings.lines,
    at: (when) => {
      moment.now = when;
    },
    restarted: async (again = {}) => {
      await runtime.dispose();
      return meteredOn(at, { ...options, ...again });
    },
    dispose: () => runtime.dispose(),
  };
}
