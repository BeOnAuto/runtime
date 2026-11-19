import { SQL } from '@event-driven-io/dumbo';
import { noLineage, type Context, type Lineage } from '@on.auto/operations';
import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import type { EncodedEvent, LedgerStore, RecordedPoint, Streams } from '../event-store.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';

export const playbookKey = 'playbook/acme/alpha/';

export const definitionKey = 'definition/acme/triage/';

export const alpha = { org: 'acme', playbook: 'alpha' };

const defaultPartition = 'emt:default';

export interface WrittenStream {
  readonly stream: string;
  readonly events: readonly EncodedEvent[];
  readonly lineage: Lineage;
}

export const ofTheRuns: Context = {
  at: '2026-10-01T09:00:00.000Z',
  by: 'tester',
  definitionType: 'workflow',
  definitionName: 'triage',
};

function aRun(at: string, status: string): readonly EncodedEvent[] {
  return [
    { type: 'run_began', data: { at, fn: 'triage' } },
    { type: 'run_ended', data: { status, ms: 5, tokens: null } },
  ];
}

function correlatedBy(correlationId: string): Lineage {
  return { causationId: null, correlationId };
}

const defined: readonly EncodedEvent[] = [{ type: 'definition_created', data: { name: 'triage' } }];

const logged: readonly EncodedEvent[] = [{ type: 'run_noted', data: {} }];

const registered: readonly EncodedEvent[] = [{ type: 'connection_noted', data: {} }];

export const keptStreams: readonly WrittenStream[] = [
  {
    stream: `${playbookKey}runs/kept`,
    events: aRun('2026-10-01T09:00:00.000Z', 'succeeded'),
    lineage: correlatedBy('kept'),
  },
  { stream: `${playbookKey}run-logs/kept`, events: logged, lineage: correlatedBy('kept') },
  {
    stream: `${playbookKey}notes/kept`,
    events: [
      { type: 'topic_opened', data: { topic: 'kept', at: 1000 } },
      { type: 'topic_opened', data: { topic: 'shared', at: 2000 } },
      { type: 'topic_noted', data: { topic: 'shared', note: 'kept' } },
    ],
    lineage: noLineage,
  },
  { stream: `${definitionKey}definitions/workflow`, events: defined, lineage: noLineage },
  { stream: 'org/acme/connections', events: registered, lineage: noLineage },
];

export const archivedRun: WrittenStream = {
  stream: `${playbookKey}runs/gone`,
  events: aRun('2026-10-01T10:00:00.000Z', 'failed'),
  lineage: correlatedBy('gone'),
};

export const archivedStreams: readonly WrittenStream[] = [
  archivedRun,
  { stream: `${playbookKey}run-logs/gone`, events: logged, lineage: correlatedBy('gone') },
  {
    stream: `${playbookKey}notes/gone`,
    events: [
      { type: 'topic_opened', data: { topic: 'gone', at: 3000 } },
      { type: 'topic_noted', data: { topic: 'shared', note: 'archived' } },
    ],
    lineage: noLineage,
  },
  { stream: `${playbookKey}definitions/workflow`, events: defined, lineage: noLineage },
  { stream: 'org/beta/connections', events: registered, lineage: noLineage },
];

export const everyStream: readonly string[] = [...keptStreams, ...archivedStreams].map(({ stream }) => stream);

export function writtenTo(streams: Pick<Streams, 'append'>, written: readonly WrittenStream[]): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(
      written,
      ({ stream, events, lineage }) =>
        Effect.promise(() => streams.append(stream, events, { expectedVersion: 0, context: ofTheRuns, lineage })),
      { discard: true },
    ),
  );
}

export function archivedBySQL(entry: LedgerEntry, database: string, streams: readonly string[]): Promise<void> {
  const named = SQL.merge(
    streams.map((stream) => SQL`${stream}`),
    ', ',
  );
  return entry.executedOn(database, async (execute) => {
    await execute.command(
      SQL`UPDATE emt_streams SET is_archived = TRUE WHERE stream_id IN (${named}) AND partition = ${defaultPartition}`,
    );
    await execute.command(
      SQL`UPDATE emt_messages SET is_archived = TRUE WHERE stream_id IN (${named}) AND partition = ${defaultPartition}`,
    );
  });
}

export async function writtenAndArchivedIn(
  entry: LedgerEntry,
  database: string,
  written: WrittenStream,
): Promise<void> {
  const store = entry.storeOn(database);
  await store.migrate();
  await writtenTo(store, [written]);
  await store.close();
  await archivedBySQL(entry, database, [written.stream]);
}

export interface KeptAndArchived {
  readonly store: LedgerStore;
  readonly keptThrough: RecordedPoint;
  readonly archivedStreamsWritten: () => Promise<readonly RecordedPoint[]>;
}

async function pointsOf(store: LedgerStore, after: RecordedPoint): Promise<readonly RecordedPoint[]> {
  return (await store.log.after(after, 100)).events.map(({ point }) => point);
}

export async function aStoreKeepingFacts(entry: LedgerEntry): Promise<KeptAndArchived> {
  const database = await entry.aDatabase();
  const store = entry.storeOn(database);
  onTestFinished(() => store.close());
  await store.migrate();
  await writtenTo(store, keptStreams);
  const keptThrough = (await store.readAppended(undefined, 0)).through;
  return {
    store,
    keptThrough,
    archivedStreamsWritten: async () => {
      await writtenTo(store, archivedStreams);
      const archivedPoints = await pointsOf(store, keptThrough);
      await archivedBySQL(
        entry,
        database,
        archivedStreams.map(({ stream }) => stream),
      );
      return archivedPoints;
    },
  };
}
