import { statement, type Statement } from '@on.auto/ledger';
import { Effect, Function, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { closeHostParts, openHostParts, type HostParts } from '../host/host-parts.ts';
import { openWorkflowStore } from '../host/workflow-store.ts';
import type { HostClock } from '../loop/host-clock.ts';
import { hostWakeUp, type HostWakeUp } from '../loop/host-wake-up.ts';
import { ledgerRunLogStore } from '../runs/ledger-run-store.ts';
import type { RecordedOptions } from '../testing/host-runs.ts';

export const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const runKey = `acme/alpha/${runId}`;

const CallSeen = Schema.Struct({
  state: Schema.String,
  call: Schema.NullOr(Schema.String),
  attributes: Schema.NullOr(Schema.String),
  result: Schema.NullOr(Schema.String),
});

const RunSeen = Schema.Struct({
  ended_at: Schema.NullOr(WholeNumber),
  ended_time: Schema.NullOr(WholeNumber),
  closed_at: Schema.NullOr(WholeNumber),
});

export type CallSeenRow = typeof CallSeen.Type;

type RunSeenRow = typeof RunSeen.Type;

export const closedRow: CallSeenRow = { state: 'closed', call: null, attributes: null, result: null };

export interface End {
  readonly version: number;
  readonly at: number;
}

interface Opened {
  readonly parts: HostParts;
  readonly wake: HostWakeUp;
}

export interface ClosingHost {
  readonly database: HostDatabase;
  readonly parts: () => HostParts;
  readonly wakeUp: (now: number, sweep?: boolean) => Promise<number | null>;
  readonly opened: () => Promise<void>;
  readonly endOf: () => Promise<End>;
  readonly calls: () => Promise<readonly CallSeenRow[]>;
  readonly run: () => Promise<readonly RunSeenRow[]>;
  readonly written: (asked: Statement) => Promise<void>;
}

function openedOver(
  store: { readonly database: HostDatabase },
  options: RecordedOptions['options'],
  clock: HostClock,
): Opened {
  const parts = openHostParts(store, { ...options, clock }, Function.constVoid);
  return { parts, wake: hostWakeUp(parts, { raised: Function.constVoid, renewed: Function.constVoid }) };
}

function readOn(database: HostDatabase) {
  return <Row>(schema: Schema.Codec<Row, unknown>, asked: Statement) =>
    Effect.runPromise(rowsOf(schema, database.read(asked)));
}

async function endIn(database: HostDatabase): Promise<End> {
  const events = await Effect.runPromise(ledgerRunLogStore(database).eventsAfter(runKey, 0));
  return { version: events.length, at: Math.max(...events.map(({ event }) => event.receipt.at)) };
}

export async function closingHostOver(
  connected: Parameters<typeof openWorkflowStore>[0],
  options: RecordedOptions['options'],
  clock: HostClock,
): Promise<ClosingHost> {
  const store = await openWorkflowStore(connected, []);
  const { database } = store;
  const held = { opened: openedOver(store, options, clock) };
  const read = readOn(database);
  return {
    database,
    parts: () => held.opened.parts,
    wakeUp: async (now, sweep = false) => (await Effect.runPromise(held.opened.wake.wakeUp({ now, sweep }))).nextDueAt,
    opened: async () => {
      await Effect.runPromise(held.opened.wake.stop());
      await closeHostParts(held.opened.parts);
      held.opened = openedOver(store, options, clock);
    },
    endOf: () => endIn(database),
    calls: () =>
      read(
        CallSeen,
        statement`SELECT state, call, attributes, result FROM workflow_calls WHERE run_key = ${runKey} ORDER BY call_key`,
      ),
    run: () =>
      read(RunSeen, statement`SELECT ended_at, ended_time, closed_at FROM workflow_runs WHERE run_key = ${runKey}`),
    written: async (asked) => {
      await Effect.runPromise(database.write(asked));
    },
  };
}
