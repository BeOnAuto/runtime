import { EmmettInstrumentation } from '@event-driven-io/emmett/otel';
import { nodeSqliteDumboDriver } from '@on.auto/node-sqlite';
import { noLineage } from '@on.auto/operations';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it, onTestFinished } from 'vitest';

import { VersionConflict, type AppendPlace, type EncodedEvent } from '../index.ts';
import { stamped } from '../testing/happenings.ts';
import { onEachSQLiteDriver } from '../testing/sqlite-drivers.ts';
import { dataAsWritten, emmettEventStore } from './emmett-event-store.ts';

const run = 'run/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const firstThree = [1, 2, 3].map((n) => ({ type: 'counted', data: { n } }));

interface Told {
  readonly stream: string;
  readonly events: readonly EncodedEvent[];
  readonly place: AppendPlace;
}

const sqliteDrivers = onEachSQLiteDriver(() => nodeSqliteDumboDriver);

describe.each(sqliteDrivers)(
  'the observer of an event store over an Emmett event store, on SQLite through $through',
  (sqlite) => {
    it('is told of each append once it is kept, with where it was kept, and not of an append that conflicts', async () => {
      const told: Told[] = [];
      const store = emmettEventStore(sqlite.anEmmettStoreInMemory(), {
        data: dataAsWritten,
        mostEventsInOneAppend: 8,
        observer: {
          appended: (stream, events, place) => {
            told.push({ stream, events, place });
          },
        },
      });
      await store.migrate();

      await store.append(run, firstThree, { expectedVersion: 0, context: stamped });
      await expect(store.append(run, firstThree, { expectedVersion: 0, context: stamped })).rejects.toBeInstanceOf(
        VersionConflict,
      );

      expect(told).toEqual([
        { stream: run, events: firstThree, place: { expectedVersion: 0, context: stamped, lineage: noLineage } },
      ]);
    });
  },
);

function tracedAppends(): InMemorySpanExporter {
  const exporter = new InMemorySpanExporter();
  const instrumentation = new EmmettInstrumentation();
  instrumentation.setTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }));
  onTestFinished(() => {
    instrumentation.disable();
  });
  return exporter;
}

describe.each(sqliteDrivers)(
  'the span of an append to an event store over an Emmett event store, on SQLite through $through',
  (sqlite) => {
    it('names the run, the correlation and the cause, and its trace is the one each message keeps', async () => {
      const exporter = tracedAppends();
      const emmett = sqlite.anEmmettStoreInMemory();
      const store = emmettEventStore(emmett, { data: dataAsWritten, mostEventsInOneAppend: 8 });
      await store.migrate();

      await store.append(run, firstThree, {
        expectedVersion: 0,
        context: { ...stamped, runId: 'run-1' },
        lineage: { causationId: 'cause-1', correlationId: 'correlation-1' },
      });
      const append = exporter
        .getFinishedSpans()
        .find(({ name }: { readonly name: string }) => name === 'eventStore.appendToStream');
      const [kept] = (await emmett.readStream(run)).events;

      expect(append?.attributes).toMatchObject({
        'auto.on.run_id': 'run-1',
        'messaging.message.correlation_id': 'correlation-1',
        'messaging.message.causation_id': 'cause-1',
      });
      expect(kept?.metadata).toMatchObject({
        traceId: append?.spanContext().traceId,
        spanId: append?.spanContext().spanId,
        correlationId: 'correlation-1',
      });
    });

    it('names no run, correlation or cause when the append has none', async () => {
      const exporter = tracedAppends();
      const store = emmettEventStore(sqlite.anEmmettStoreInMemory(), { data: dataAsWritten, mostEventsInOneAppend: 8 });
      await store.migrate();

      await store.append(run, firstThree, { expectedVersion: 0, context: stamped });
      const append = exporter
        .getFinishedSpans()
        .find(({ name }: { readonly name: string }) => name === 'eventStore.appendToStream');

      expect(append?.attributes).not.toHaveProperty('auto.on.run_id');
    });
  },
);
