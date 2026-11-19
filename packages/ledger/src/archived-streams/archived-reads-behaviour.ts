import { messageIdOf, type RecordedSelection } from '@on.auto/operations';
import { expect, it } from 'vitest';

import type { FactScope, LedgerStore, RecordedPoint, StoredPageRequest } from '../event-store.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';
import {
  aStoreKeepingFacts,
  archivedStreams,
  definitionKey,
  everyStream,
  keptStreams,
  ofTheRuns,
  playbookKey,
  type KeptAndArchived,
} from './archived-streams.ts';

type Read = (kept: KeptAndArchived) => Promise<unknown>;

interface PortRead {
  readonly port: string;
  readonly read: Read;
}

const mebibyte = 1024 * 1024;

const ofBothKeys = { org: 'acme', keys: [playbookKey, definitionKey] } as const;

const selections: readonly RecordedSelection[] = [
  { kind: 'everything' },
  { kind: 'runs' },
  { kind: 'runs', definitionType: 'workflow', name: 'triage' },
  { kind: 'run', run: 'kept' },
  { kind: 'run', run: 'gone' },
  { kind: 'correlated', correlation: 'kept' },
  { kind: 'correlated', correlation: 'gone' },
];

const pages: readonly StoredPageRequest[] = [
  { order: 'asc', limit: 100 },
  { order: 'desc', limit: 100 },
  { order: 'asc', limit: 1 },
  { order: 'asc', limit: 100, since: '2000-01-01T00:00:00.000Z' },
  { order: 'asc', limit: 100, types: ['run_began'], dataOf: ['run_began'] },
];

const scopes: readonly FactScope[] = [
  { kind: 'playbook', playbookKey, definitionKeys: [] },
  { kind: 'streams', streams: everyStream },
  { kind: 'streams', streams: [`${playbookKey}runs`, `${playbookKey}runs/`] },
];

const everyId: readonly string[] = [...keptStreams, ...archivedStreams].flatMap(({ stream, events }) =>
  events.map((_, index) => messageIdOf(stream, index + 1)),
);

function eachOf<A>(items: readonly A[], read: (item: A) => Promise<unknown>): Promise<readonly unknown[]> {
  return Promise.all(items.map((item) => read(item)));
}

function everyPageOf(read: (selection: RecordedSelection, page: StoredPageRequest) => Promise<unknown>) {
  return eachOf(selections, (selection) => eachOf(pages, (page) => read(selection, page)));
}

function theStart(store: LedgerStore): RecordedPoint {
  return Array.from({ length: store.pointLength }, () => '0');
}

const nowLeftOut: RecordedPoint = [];

const streamReads: readonly PortRead[] = [
  {
    port: 'read, from the start and after a version',
    read: ({ store }) => eachOf(everyStream, async (stream) => [await store.read(stream), await store.read(stream, 1)]),
  },
  { port: 'readPage', read: ({ store }) => eachOf(everyStream, (stream) => store.readPage(stream, 0, mebibyte)) },
  {
    port: 'messageAt',
    read: ({ store }) =>
      eachOf(everyStream, async (stream) => [await store.messageAt(stream, 1), await store.messageAt(stream, 2)]),
  },
  { port: 'lastMessageOf', read: ({ store }) => eachOf(everyStream, (stream) => store.lastMessageOf(stream)) },
  { port: 'versionOf', read: ({ store }) => eachOf(everyStream, (stream) => store.versionOf(stream)) },
  {
    port: 'ageOfLastAppend, whether a stream has a last append',
    read: ({ store }) => eachOf(everyStream, async (stream) => Number.isFinite(await store.ageOfLastAppend(stream))),
  },
  { port: 'lastPositionOf', read: ({ store }) => eachOf(everyStream, (stream) => store.lastPositionOf(stream)) },
  { port: 'definitionStreams', read: ({ store }) => store.definitionStreams('workflow') },
  { port: 'orgStreams', read: ({ store }) => store.orgStreams('connections') },
  {
    port: 'factAt',
    read: ({ store }) =>
      eachOf(everyStream, async (stream) => [await store.factAt(stream, 1), await store.factAt(stream, 2)]),
  },
];

const recordedReads: readonly PortRead[] = [
  {
    port: 'readRecorded, of every selection and every kind of page',
    read: ({ store }) => everyPageOf((selection, page) => store.readRecorded(playbookKey, selection, page)),
  },
  {
    port: 'readRecordedOfKeys, of every selection and every kind of page',
    read: ({ store }) => everyPageOf((selection, page) => store.readRecordedOfKeys(ofBothKeys, selection, page)),
  },
  {
    port: 'readRecordedOfOrg, of every kind of page',
    read: ({ store }) =>
      eachOf(
        pages.filter(({ since }) => since === undefined),
        (page) => store.readRecordedOfOrg(ofBothKeys.org, page),
      ),
  },
  {
    port: 'readRecordedEvent, of the id of every fact written',
    read: ({ store }) => eachOf(everyId, (id) => store.readRecordedEvent(playbookKey, id)),
  },
  {
    port: 'readRecordedEventOfKeys, of the id of every fact written',
    read: ({ store }) => eachOf(everyId, (id) => store.readRecordedEventOfKeys(ofBothKeys, id)),
  },
  {
    port: 'readAppended, from the start and from the place the kept facts end',
    read: ({ store, keptThrough }) =>
      eachOf([theStart(store), keptThrough], async (after) => ({
        ...(await store.readAppended(after, 100)),
        through: nowLeftOut,
      })),
  },
  {
    port: 'readAppendedFacts, from the start of each scope and from now',
    read: ({ store }) =>
      eachOf(scopes, async (scope) => [
        {
          ...(await store.readAppendedFacts(scope, { after: null, most: 100, dataOf: ['run_began'] })),
          through: nowLeftOut,
        },
        { ...(await store.readAppendedFacts(scope, { most: 100, dataOf: [] })), through: nowLeftOut },
      ]),
  },
  {
    port: 'waitForAppend, in each scope after the place the kept facts end',
    read: ({ store, keptThrough }) =>
      eachOf(scopes, (scope) => store.waitForAppend(scope, keptThrough, AbortSignal.timeout(1500))),
  },
];

const logReads: readonly PortRead[] = [
  { port: 'log.head', read: ({ store }) => store.log.head() },
  {
    port: 'log.after, from the start and from the place the kept facts end',
    read: ({ store, keptThrough }) => eachOf([undefined, keptThrough], (after) => store.log.after(after, 100)),
  },
  {
    port: 'log.at, of every point the log names',
    read: async ({ store }) => {
      const { events } = await store.log.after(undefined, 100);
      return eachOf(events, ({ point }) => store.log.at(point));
    },
  },
];

function readAsNeverWritten(entry: LedgerEntry, { port, read }: PortRead): void {
  it(`${port} answers as it did before the archived streams were written`, async () => {
    const kept = await aStoreKeepingFacts(entry);
    const before = await read(kept);

    await kept.archivedStreamsWritten();

    expect(await read(kept)).toEqual(before);
  });
}

function pointsOfArchivedFacts(entry: LedgerEntry): void {
  it('log.at answers nothing at the point of an archived fact', async () => {
    const { store, archivedStreamsWritten } = await aStoreKeepingFacts(entry);

    const archivedPoints = await archivedStreamsWritten();

    expect(archivedPoints).toHaveLength(archivedStreams.flatMap(({ events }) => events).length);
    expect(await eachOf(archivedPoints, (point) => store.log.at(point))).toEqual(
      Array.from({ length: archivedPoints.length }),
    );
  });
}

function appendedAfterNow(entry: LedgerEntry): void {
  it('readAppended from now names no archived stream, and names a stream appended to after now', async () => {
    const { store, archivedStreamsWritten } = await aStoreKeepingFacts(entry);
    await archivedStreamsWritten();

    const now = await store.readAppended(undefined, 0);
    const beforeTheAppend = await store.readAppended(now.through, 100);
    await store.append(`${playbookKey}notes/later`, [{ type: 'topic_noted', data: { topic: 'later', note: '' } }], {
      expectedVersion: 0,
      context: ofTheRuns,
    });
    const afterTheAppend = await store.readAppended(now.through, 100);

    expect([beforeTheAppend.streams, afterTheAppend.streams]).toEqual([[], [`${playbookKey}notes/`]]);
  });
}

export function archivedReadsBehaviour(entry: LedgerEntry): void {
  for (const portRead of [...streamReads, ...recordedReads, ...logReads]) {
    readAsNeverWritten(entry, portRead);
  }
  pointsOfArchivedFacts(entry);
  appendedAfterNow(entry);
}
