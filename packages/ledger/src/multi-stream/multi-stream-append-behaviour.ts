import { messageIdOf } from '@on.auto/operations';
import { runTallyRows, topicRows } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { EncodedEvent, FactPlace, LedgerStore, RecordedPoint } from '../event-store.ts';
import { streamAppends } from '../signal/append-signal.ts';
import { isVersionConflict } from '../version-conflict.ts';
import {
  mostBytesInAMultiStreamAppend,
  mostEventsInAMultiStreamAppend,
  type AppendStreamRequest,
} from './multi-stream-appends.ts';
import {
  aStoreKeeping,
  alpha,
  at,
  began,
  logged,
  noted,
  placeOf,
  r0,
  r1,
  r2,
  r3,
  refusalOf,
  rowsOf,
  to,
  triage,
  triageKey,
  versionsOf,
  type Logged,
  type MultiStreamEntry,
} from './multi-stream-cases.ts';
import {
  keptNothingOnAConflict,
  keptNothingOnAFailure,
  keptNothingOnARefusal,
  keptNothingOnARefusalOfOneStream,
} from './multi-stream-refusals-behaviour.ts';

async function streamsAppended(store: LedgerStore): Promise<void> {
  await store.append(r0, [noted(0)], at(0));
  await store.multiStreamAppend([
    to(r2, 0, noted(3)),
    to(triage, 0, noted(4)),
    to(r0, 1, noted(1), noted(2)),
    to(r1, 0, noted(5)),
  ]);
  await store.append(r3, [noted(6)], at(0));
}

const theWholeLog: readonly Logged[] = [
  [r0, 1, messageIdOf(r0, 1)],
  [triage, 1, messageIdOf(triage, 1)],
  [r0, 2, messageIdOf(r0, 2)],
  [r0, 3, messageIdOf(r0, 3)],
  [r1, 1, messageIdOf(r1, 1)],
  [r2, 1, messageIdOf(r2, 1)],
  [r3, 1, messageIdOf(r3, 1)],
];

function keptWhole(entry: MultiStreamEntry): void {
  it('keeps the facts of every stream in one transaction, each at the version its request expects, grouped by stream in the order of their names', async () => {
    const store = await aStoreKeeping(entry, { projections: [runTallyRows] });

    await streamsAppended(store);

    expect(await logged(store)).toEqual(theWholeLog);
    expect(await versionsOf(store, [r0, r1, r2, r3, triage])).toEqual([3, 1, 1, 1, 1]);
    expect((await store.read(r0)).messages.map(({ data, lineage }) => [data, lineage.id])).toEqual([
      [{ n: 0 }, messageIdOf(r0, 1)],
      [{ n: 1 }, messageIdOf(r0, 2)],
      [{ n: 2 }, messageIdOf(r0, 3)],
    ]);
  });
}

async function logPagesFrom(store: LedgerStore, after?: RecordedPoint): Promise<readonly Logged[]> {
  const page = await store.log.after(after, 1);
  const rest = page.more ? await logPagesFrom(store, page.through) : [];
  return [...page.events.map(placeOf), ...rest];
}

const HeldPage = Schema.Struct({
  held: Schema.Literal(true),
  facts: Schema.Array(Schema.Struct({ stream: Schema.String, version: Schema.Number })),
  last: Schema.NullOr(Schema.Struct({ point: Schema.Array(Schema.String), id: Schema.String })),
  more: Schema.Boolean,
});

async function factPagesFrom(store: LedgerStore, after: FactPlace | null): Promise<readonly string[]> {
  const page = Schema.decodeUnknownSync(HeldPage)(
    await store.readAppendedFacts({ kind: 'playbook', playbookKey: alpha }, { after, most: 1, dataOf: [] }),
  );
  const facts = page.facts.map(({ stream, version }) => `${stream} ${version}`);
  return page.more ? [...facts, ...(await factPagesFrom(store, page.last))] : facts;
}

async function keyPagesFrom(store: LedgerStore, after?: RecordedPoint): Promise<readonly string[]> {
  const page = await store.readRecordedOfKeys(
    { org: 'acme', keys: [alpha, triageKey] },
    { kind: 'everything' },
    { order: 'asc', limit: 1, ...(after === undefined ? {} : { after }) },
  );
  const records = page.records.map(({ stream, version }) => `${stream} ${version}`);
  return page.resumeAfter === undefined ? records : [...records, ...(await keyPagesFrom(store, page.resumeAfter))];
}

function pagedThrough(entry: MultiStreamEntry): void {
  it('is read a fact at a time, by the log, by the facts appended to a playbook and by a read over keys, each fact once and in the order it was kept', async () => {
    const store = await aStoreKeeping(entry);
    await streamsAppended(store);
    const inOrder = theWholeLog.map(([stream, version]) => `${stream} ${version}`);

    expect(await logPagesFrom(store)).toEqual(theWholeLog);
    expect(await factPagesFrom(store, null)).toEqual(inOrder.filter((place) => place.startsWith(alpha)));
    expect(await keyPagesFrom(store)).toEqual(inOrder);
  });
}

function foldedOnce(entry: MultiStreamEntry): void {
  it('folds every fact of the append into each inline projection once, in the order the facts were kept', async () => {
    const store = await aStoreKeeping(entry, { projections: [runTallyRows, topicRows] });
    await store.append(r0, [{ type: 'topic_opened', data: { topic: 'autumn', at: 1000 } }], at(0));

    await store.multiStreamAppend([
      to(`${alpha}notes/n2`, 0, { type: 'topic_noted', data: { topic: 'autumn', note: 'second' } }),
      to(r2, 0, began),
      to(r1, 0, began, { type: 'run_noted', data: {} }, { type: 'run_noted', data: {} }),
      to(`${alpha}notes/n1`, 0, { type: 'topic_noted', data: { topic: 'autumn', note: 'first' } }),
    ]);

    expect(await rowsOf(store, 'run_tallies', ['facts', 'status', 'last_message'])).toEqual([
      ['r1', [3, 'started', messageIdOf(r1, 3)]],
      ['r2', [1, 'started', messageIdOf(r2, 1)]],
    ]);
    expect(await rowsOf(store, 'topics', ['note', 'last_message'])).toEqual([
      ['autumn', ['second', messageIdOf(`${alpha}notes/n2`, 1)]],
    ]);
  });
}

function refusedBeforeAnything(entry: MultiStreamEntry): void {
  it('refuses as a defect, before anything is kept, no stream, a stream named twice, a stream given no event, more events in a stream than the store takes in one append, and more than its bound in all', async () => {
    const store = await aStoreKeeping(entry);
    const most = entry.mostEventsInOneAppend;
    const tooMany = Array.from({ length: most + 1 }, (_, index) => noted(index));
    const beyondTheBound = Array.from({ length: mostEventsInAMultiStreamAppend / most + 1 }, (_, index) =>
      to(`${alpha}runs/many-${index}`, 0, ...tooMany.slice(1)),
    );
    const asked: readonly (readonly AppendStreamRequest[])[] = [
      [],
      [to(r0, 0, noted(1)), to(r0, 0, noted(2))],
      [to(r0, 0, noted(1)), to(r1, 0)],
      [to(r0, 0, ...tooMany)],
      beyondTheBound,
    ];

    const refused = await Promise.all(
      asked.map(async (requests) => String(await refusalOf(store.multiStreamAppend(requests)))),
    );

    expect(refused).toEqual([
      'RangeError: A multi-stream append names no stream',
      `RangeError: A multi-stream append names ${r0} more than once`,
      `RangeError: A multi-stream append gives ${r1} no event`,
      `RangeError: A multi-stream append gives ${r0} ${most + 1} events, more than ${most}`,
      `RangeError: A multi-stream append gives ${mostEventsInAMultiStreamAppend + most} events, more than ${mostEventsInAMultiStreamAppend}`,
    ]);
    expect(await logged(store)).toEqual([]);
  });
}

const emptyText = JSON.stringify({ text: '' }).length;

function textOfBytes(bytes: number): EncodedEvent {
  return { type: 'noted', data: { text: 'x'.repeat(bytes - emptyText) } };
}

const factsOfAStreamOnEveryStore = 8;

function ofTheBoundInBytes(beyond: number): readonly AppendStreamRequest[] {
  const factBytes = mostBytesInAMultiStreamAppend / mostEventsInAMultiStreamAppend;
  return Array.from({ length: mostEventsInAMultiStreamAppend / factsOfAStreamOnEveryStore }, (_, stream) =>
    to(
      `${alpha}notes/bound-${stream}`,
      0,
      ...Array.from({ length: factsOfAStreamOnEveryStore }, (__, fact) =>
        textOfBytes(factBytes + (stream === 0 && fact === 0 ? beyond : 0)),
      ),
    ),
  );
}

function keptAtItsBoundInBytes(entry: MultiStreamEntry): void {
  it('keeps an append whose event data holds exactly its bound in bytes, and refuses one byte more as a defect before anything is kept', async () => {
    const store = await aStoreKeeping(entry);
    const streams = ofTheBoundInBytes(0).map(({ stream }) => stream);

    const refused = String(await refusalOf(store.multiStreamAppend(ofTheBoundInBytes(1))));
    const versionsAfterTheRefusal = await versionsOf(store, streams);
    await store.multiStreamAppend(ofTheBoundInBytes(0));

    expect(refused).toBe(
      `RangeError: A multi-stream append gives ${mostBytesInAMultiStreamAppend + 1} bytes of event data, more than ${mostBytesInAMultiStreamAppend}`,
    );
    expect(versionsAfterTheRefusal).toEqual(streams.map(() => 0));
    expect(await versionsOf(store, streams)).toEqual(streams.map(() => factsOfAStreamOnEveryStore));
  });
}

function appendedOnce(entry: MultiStreamEntry): void {
  it('appends nothing on any stream when the same append is made again, every version it expects having passed', async () => {
    const store = await aStoreKeeping(entry);
    const requests = [to(r0, 0, noted(1)), to(r1, 0, noted(2))];
    await store.multiStreamAppend(requests);
    const before = await logged(store);

    const refused = await refusalOf(store.multiStreamAppend(requests));

    expect(isVersionConflict(refused)).toBe(true);
    expect(await logged(store)).toEqual(before);
  });
}

function heardOnceKept(entry: MultiStreamEntry): void {
  it('tells the signal of an append of each of its streams once it commits, and of none when it is refused', async () => {
    const store = await aStoreKeeping(entry);
    const heard: string[] = [];
    onTestFinished(
      streamAppends.listen((stream) => {
        heard.push(stream);
      }),
    );

    await store.multiStreamAppend([to(r1, 0, noted(1)), to(r0, 0, noted(2))]);
    await refusalOf(store.multiStreamAppend([to(r2, 0, noted(3)), to(r0, 0, noted(4))]));

    expect(heard).toEqual([r0, r1]);
  });
}

export function multiStreamAppendBehaviour(entry: MultiStreamEntry): void {
  describe('an append to several streams, all or nothing', () => {
    keptWhole(entry);
    pagedThrough(entry);
    keptNothingOnAConflict(entry);
    keptNothingOnARefusal(entry);
    keptNothingOnARefusalOfOneStream(entry);
    keptNothingOnAFailure(entry);
    foldedOnce(entry);
    refusedBeforeAnything(entry);
    keptAtItsBoundInBytes(entry);
    appendedOnce(entry);
    heardOnceKept(entry);
  });
}
