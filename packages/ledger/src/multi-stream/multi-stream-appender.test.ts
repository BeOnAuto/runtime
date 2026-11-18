import { SQL } from '@event-driven-io/dumbo';
import { EmmettInstrumentation } from '@event-driven-io/emmett/otel';
import { Conflict, messageIdOf } from '@on.auto/operations';
import { context } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Cause, Effect, Exit } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { nodeSqliteEventStoreDriver } from '../connection/node-sqlite-event-store-driver.ts';
import type { EncodedEvent } from '../event-store.ts';
import { multiStreamAppenderOf, type MultiStreamAppends, StreamRefused, VersionConflict } from '../index.ts';
import { appendRefusedAs } from '../refusals/append-refused.ts';
import { sqliteEventStore } from '../sqlite-event-store.ts';
import { happenings, noted, stamped } from '../testing/happenings.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { isVersionConflict } from '../version-conflict.ts';
import type { BeforeCommit } from './joined-appends.ts';

const one = 'playbook/acme/alpha/notes/one';

const other = 'playbook/acme/alpha/notes/other';

async function aStore() {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  const store = sqliteEventStore(() => ({ driver: nodeSqliteEventStoreDriver, fileName }));
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

function rejectingWith(rejected: () => Error): MultiStreamAppends {
  return { multiStreamAppend: () => Promise.reject(rejected()) };
}

const appended = [
  { stream: other, events: [noted('noted', 1)], place: { expectedVersion: 0, context: stamped } },
  {
    stream: one,
    events: [noted('noted', 2), noted('noted', 3)],
    place: { expectedVersion: 0, context: { ...stamped, by: 'another tester' } },
  },
];

async function failureOf(store: MultiStreamAppends): Promise<unknown> {
  const exit = await Effect.runPromiseExit(multiStreamAppenderOf(store, happenings.eventSchema)(appended));
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
}

const alpha = 'playbook/acme/alpha/';

const place = { expectedVersion: 0, context: stamped };

const notedMultiStreamSqlite: readonly EncodedEvent[] = [{ type: 'noted', data: {} }];

interface Gate {
  readonly entered: Promise<void>;
  readonly letGo: () => void;
  readonly passed: (messages: readonly unknown[]) => Promise<void>;
}

function aGate(): Gate {
  const entered = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  return {
    entered: entered.promise,
    letGo: () => {
      held.resolve();
    },
    passed: async (messages) => {
      if (messages.length > 1) {
        entered.resolve();
        await held.promise;
      }
    },
  };
}

async function aStoreWith(onBeforeCommit: BeforeCommit) {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  const store = sqliteEventStore(() => ({ driver: nodeSqliteEventStoreDriver, fileName, hooks: { onBeforeCommit } }));
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

function heldBackUntilItCommits(): void {
  it('shows a reader none of its facts while its transaction is open, and all of them once it commits', async () => {
    const gate = aGate();
    const store = await aStoreWith(gate.passed);
    const factsOfAlpha = () =>
      store.readAppendedFacts(
        { kind: 'playbook', playbookKey: alpha, definitionKeys: [] },
        { after: null, most: 10, dataOf: [] },
      );

    const appending = store.multiStreamAppend([
      { stream: `${alpha}notes/b`, events: notedMultiStreamSqlite, place },
      { stream: `${alpha}notes/a`, events: notedMultiStreamSqlite, place },
    ]);
    await gate.entered;
    const whileOpen = [await factsOfAlpha(), (await store.log.after(undefined, 10)).events.length];
    gate.letGo();
    await appending;

    expect(whileOpen).toEqual([expect.objectContaining({ held: true, facts: [] }), 0]);
    expect(await factsOfAlpha()).toMatchObject({
      held: true,
      facts: [
        { stream: `${alpha}notes/a`, version: 1 },
        { stream: `${alpha}notes/b`, version: 1 },
      ],
    });
  });
}

const writtenOnce: BeforeCommit = async (_messages, { transaction }) => {
  await transaction.execute.command(SQL`CREATE TABLE IF NOT EXISTS written_once (id INTEGER PRIMARY KEY)`);
  await transaction.execute.command(SQL`INSERT INTO written_once (id) VALUES (1)`);
};

function aRowWrittenTwiceMetAsAConflict(): void {
  it('meets a row its transaction writes twice as a version conflict, as an append to one stream does, and keeps nothing', async () => {
    const store = await aStoreWith(writtenOnce);
    await store.append(`${alpha}notes/a`, notedMultiStreamSqlite, place);

    const refused = await Promise.all([
      store.append(`${alpha}notes/b`, notedMultiStreamSqlite, place).catch((error: unknown) => error),
      store
        .multiStreamAppend([
          { stream: `${alpha}notes/c`, events: notedMultiStreamSqlite, place },
          { stream: `${alpha}notes/d`, events: notedMultiStreamSqlite, place },
        ])
        .catch((error: unknown) => error),
    ]);

    expect(refused.map((error) => isVersionConflict(error))).toEqual([true, true]);
    expect((await store.log.after(undefined, 10)).events.map(({ stream }) => stream)).toEqual([`${alpha}notes/a`]);
  });
}

const [a, b] = ['playbook/acme/alpha/notes/a', 'playbook/acme/alpha/notes/b'] as const;

const notedMultiStreamSpans = { type: 'noted', data: {} };

type FinishedSpans = ReturnType<InMemorySpanExporter['getFinishedSpans']>;

function traced(): () => FinishedSpans {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  const exporter = new InMemorySpanExporter();
  const instrumentation = new EmmettInstrumentation();
  instrumentation.setTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }));
  onTestFinished(() => {
    instrumentation.disable();
    context.disable();
  });
  return () => exporter.getFinishedSpans();
}

interface FinishedSpan {
  readonly name: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

function statusesOf(spans: readonly FinishedSpan[]): readonly (readonly unknown[])[] {
  return spans
    .filter(({ name }: FinishedSpan) => name === 'eventStore.appendToStream')
    .map(({ attributes }: FinishedSpan) => [
      attributes['emmett.stream.name'],
      attributes['emmett.eventstore.append.status'],
    ]);
}

describe('the appender of decided events to several streams', () => {
  it('encodes the events of each stream with its own context and appends them all at once', async () => {
    const store = await aStore();

    await Effect.runPromise(multiStreamAppenderOf(store, happenings.eventSchema)(appended));

    expect(
      (await store.read(one)).messages.map(({ data, context: contextMultiStreamAppender, lineage }) => [
        data,
        contextMultiStreamAppender.by,
        lineage.id,
      ]),
    ).toEqual([
      [{ detail: 2 }, 'another tester', messageIdOf(one, 1)],
      [{ detail: 3 }, 'another tester', messageIdOf(one, 2)],
    ]);
    expect(
      (await store.read(other)).messages.map(({ data, context: contextMultiStreamAppender }) => [
        data,
        contextMultiStreamAppender.by,
      ]),
    ).toEqual([[{ detail: 1 }, 'tester']]);
  });

  it('fails with a version conflict when a stream was not at the version expected, so a decision is made again', async () => {
    const store = await aStore();
    await store.append(one, [{ type: 'noted', data: { detail: 0 } }], { expectedVersion: 0, context: stamped });

    expect(await failureOf(store)).toEqual(new VersionConflict());
  });

  it('fails with the refusal of an inline projection, naming the stream whose fact it refused', async () => {
    const taken = new Conflict({ detail: 'The name is taken', kind: 'taken' });

    expect(await failureOf(rejectingWith(() => appendRefusedAs(taken, one)))).toEqual(
      new StreamRefused({ stream: one, conflict: taken }),
    );
  });

  it('takes any other failure of the store as a defect', async () => {
    const gone = new Error('The database is gone');

    expect(await failureOf(rejectingWith(() => gone))).toBe(gone);
  });
});

describe('An append to several streams on a SQLite file', () => {
  heldBackUntilItCommits();
  aRowWrittenTwiceMetAsAConflict();
});

describe("Emmett's spans of an append to several streams on a SQLite file", () => {
  it('leave the span of a stream appended inside its transaction a success when the append is rolled back after it, while the observer is told nothing of it', async () => {
    const finished = traced();
    const { fileName, remove } = temporaryDatabase();
    onTestFinished(remove);
    const observed: string[] = [];
    const appendedMultiStreamSpans = (stream: string): void => {
      observed.push(stream);
    };
    const store = sqliteEventStore(
      () => ({ driver: nodeSqliteEventStoreDriver, fileName }),
      {},
      { observer: { appended: appendedMultiStreamSpans } },
    );
    onTestFinished(() => store.close());
    await store.migrate();
    await store.append(b, [notedMultiStreamSpans], place);
    const before = finished().length;

    const refused = await store
      .multiStreamAppend([
        { stream: a, events: [notedMultiStreamSpans], place },
        { stream: b, events: [notedMultiStreamSpans], place },
      ])
      .catch((error: unknown) => error);

    expect(isVersionConflict(refused)).toBe(true);
    expect(statusesOf(finished().slice(before))).toEqual([
      [a, 'success'],
      [b, 'failure'],
    ]);
    expect(observed).toEqual([b]);
    expect((await store.read(a)).version).toBe(0);
  });
});
