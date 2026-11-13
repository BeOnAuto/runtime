import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { EmmettInstrumentation } from '@event-driven-io/emmett/otel';
import { context } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it, onTestFinished } from 'vitest';

import { sqliteEventStore } from '../sqlite-event-store.ts';
import { stamped } from '../testing/happenings.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { isVersionConflict } from '../version-conflict.ts';

const [a, b] = ['playbook/acme/alpha/notes/a', 'playbook/acme/alpha/notes/b'] as const;

const place = { expectedVersion: 0, context: stamped };

const noted = { type: 'noted', data: {} };

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

describe("Emmett's spans of an append to several streams on a SQLite file", () => {
  it('leave the span of a stream appended inside its transaction a success when the append is rolled back after it, while the observer is told nothing of it', async () => {
    const finished = traced();
    const { fileName, remove } = temporaryDatabase();
    onTestFinished(remove);
    const observed: string[] = [];
    const appended = (stream: string): void => {
      observed.push(stream);
    };
    const store = sqliteEventStore(
      () => ({ driver: sqlite3EventStoreDriver, fileName }),
      {},
      { observer: { appended } },
    );
    onTestFinished(() => store.close());
    await store.migrate();
    await store.append(b, [noted], place);
    const before = finished().length;

    const refused = await store
      .multiStreamAppend([
        { stream: a, events: [noted], place },
        { stream: b, events: [noted], place },
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
