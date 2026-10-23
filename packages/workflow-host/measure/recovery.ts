import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { hostDatabaseOpenedOn, type DatabaseSettings } from '../src/ledger-testing/ledger-connections.ts';
import { header, measuredHost, runAt, startOf } from './measured-host.ts';

export interface Recovery {
  readonly snapshotBytes: number;
  readonly eventsAfterIt: number;
  readonly openMs: number;
  readonly firstInputMs: number;
  readonly nextInputMs: number;
}

const listening = {
  document: header,
  do: [{ approval: { listen: { to: { one: { with: { type: 'com.acme.approved' } } } } } }],
};

const eventsAfterTheSnapshot = 50;

const SnapshotRow = Schema.Struct({ bytes: Schema.Union([Schema.Finite, Schema.FiniteFromString]) });

function millisecondsOf<A>(work: () => Promise<A>): Promise<number> {
  const started = performance.now();
  return work().then(() => performance.now() - started);
}

async function snapshotBytesOf(database: DatabaseSettings): Promise<number> {
  const opened = await hostDatabaseOpenedOn(database);
  const rows = await Effect.runPromise(
    opened.read(statement`SELECT SUM(bytes) AS bytes FROM workflow_snapshot_chunks`),
  );
  await opened.close();
  return Schema.decodeUnknownSync(Schema.Tuple([SnapshotRow]))(rows)[0].bytes;
}

function deliveredTo(measured: Awaited<ReturnType<typeof measuredHost>>, index: number): Promise<unknown> {
  return Effect.runPromise(measured.host.deliver(runAt(0), { id: `noise-${index}`, type: 'com.acme.noise' }));
}

export async function recoveryOn(database: DatabaseSettings): Promise<Recovery> {
  const before = await measuredHost(database);
  await Effect.runPromise(before.host.start(runAt(0), startOf(listening, { text: 'x'.repeat(1_100_000) })));
  await Effect.runPromise(
    Effect.forEach(
      Array.from({ length: eventsAfterTheSnapshot }, (_, index) => index),
      (index) => Effect.promise(() => deliveredTo(before, index)),
      { discard: true },
    ),
  );
  await before.host.stop();
  const opening = { after: before };
  const openMs = await millisecondsOf(async () => {
    opening.after = await measuredHost(database);
  });
  const after = opening.after;
  const firstInputMs = await millisecondsOf(() => deliveredTo(after, eventsAfterTheSnapshot));
  const nextInputMs = await millisecondsOf(() => deliveredTo(after, eventsAfterTheSnapshot + 1));
  await after.host.stop();
  return {
    snapshotBytes: await snapshotBytesOf(database),
    eventsAfterIt: eventsAfterTheSnapshot,
    openMs,
    firstInputMs,
    nextInputMs,
  };
}
