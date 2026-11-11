import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { EmmettInstrumentation } from '@event-driven-io/emmett/otel';
import { runTallies } from '@on.auto/operations/testing';
import { context } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it, onTestFinished } from 'vitest';

import { inTransactionOf } from '../event-store.ts';
import { pooledOptionsOf, sqliteEventStore } from '../sqlite-event-store.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';

type Pool = ReturnType<typeof pooledOptionsOf>['pool'];

interface Traced {
  readonly finishedSpans: () => ReturnType<InMemorySpanExporter['getFinishedSpans']>;
  readonly underACaller: (work: () => Promise<unknown>) => Promise<string>;
}

function traced(): Traced {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const instrumentation = new EmmettInstrumentation();
  instrumentation.setTracerProvider(provider);
  onTestFinished(() => {
    instrumentation.disable();
    context.disable();
  });
  return {
    finishedSpans: () => exporter.getFinishedSpans(),
    underACaller: (work) =>
      provider.getTracer('the caller').startActiveSpan('the caller', async (span) => {
        await work();
        span.end();
        return span.spanContext().spanId;
      }),
  };
}

interface Ledger {
  readonly appended: () => Promise<unknown>;
  readonly heldUntilLetGo: () => Promise<() => Promise<void>>;
  readonly handedToTheWriter: Promise<void>;
}

async function aLedgerFileWithAProjection(): Promise<Ledger> {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  const { pool } = pooledOptionsOf(() => ({ driver: sqlite3EventStoreDriver, fileName }));
  const handing = { next: Promise.withResolvers<void>() };
  const withConnection: Pool['withConnection'] = (handle) => {
    const answer = pool.withConnection(handle, { readonly: false });
    handing.next.resolve();
    return answer;
  };
  const store = sqliteEventStore(
    () => ({ driver: sqlite3EventStoreDriver, fileName, pool: { ...pool, withConnection } }),
    { runOutcomes: runTallies },
  );
  await store.migrate();
  onTestFinished(() => store.close());
  handing.next = Promise.withResolvers<void>();
  const appended = () =>
    store.append('org/acme/notes', [{ type: 'noted', data: {} }], {
      expectedVersion: 0,
      context: { at: '2026-11-11T09:00:00.000Z', by: 'tester' },
    });
  const heldUntilLetGo = async () => {
    const begun = Promise.withResolvers<void>();
    const letGo = Promise.withResolvers<void>();
    const held = inTransactionOf(pool)(async () => {
      begun.resolve();
      await letGo.promise;
    });
    await begun.promise;
    return async () => {
      letGo.resolve();
      await held;
    };
  };
  return { appended, heldUntilLetGo, handedToTheWriter: handing.next.promise };
}

interface Parents {
  readonly ofTheAppend: string | undefined;
  readonly ofItsProjection: string | undefined;
  readonly expected: readonly [string, string | undefined];
}

async function parentsOfAnAppendUnderACaller(
  { appended, handedToTheWriter }: Ledger,
  { finishedSpans, underACaller }: Traced,
  whileItWaits: () => Promise<void>,
): Promise<Parents> {
  const caller = underACaller(appended);
  await handedToTheWriter;
  await whileItWaits();
  const callerSpan = await caller;
  const spans = finishedSpans();
  const append = spans.find(({ name }: { readonly name: string }) => name === 'eventStore.appendToStream');
  const projection = spans.find(({ name }: { readonly name: string }) => name === 'eventStore.inlineProjection');
  return {
    ofTheAppend: append?.parentSpanContext?.spanId,
    ofItsProjection: projection?.parentSpanContext?.spanId,
    expected: [callerSpan, append?.spanContext().spanId],
  };
}

describe('the spans of an append to a ledger on SQLite, made under a span of its caller', () => {
  it('sit under the append and the append under its caller where its write waits behind a transaction of the writer', async () => {
    const tracing = traced();
    const ledger = await aLedgerFileWithAProjection();
    const letGo = await ledger.heldUntilLetGo();

    const { ofTheAppend, ofItsProjection, expected } = await parentsOfAnAppendUnderACaller(ledger, tracing, letGo);

    expect([ofTheAppend, ofItsProjection]).toEqual(expected);
  });

  it('sit under the append and the append under its caller where the writer is idle', async () => {
    const tracing = traced();
    const ledger = await aLedgerFileWithAProjection();

    const { ofTheAppend, ofItsProjection, expected } = await parentsOfAnAppendUnderACaller(ledger, tracing, () =>
      Promise.resolve(),
    );

    expect([ofTheAppend, ofItsProjection]).toEqual(expected);
  });
});
