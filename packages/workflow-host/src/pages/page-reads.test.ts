import { erasingReader, keptIn } from '@on.auto/definitions/testing';
import type { LedgerStreams, StoredPage, StoredRecord } from '@on.auto/ledger';
import { Unavailable } from '@on.auto/operations';
import { payloadReaderOf, type PayloadReader } from '@on.auto/operations/payloads';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { onSQLite, openedOn } from '../testing/host-files.ts';
import { pageReadBounds, readPage } from './page-events.ts';

const playbookKey = 'playbook/acme/alpha/';

const alpha = { org: 'acme', playbook: 'alpha' };

const at = '2026-10-01T09:00:00.000Z';

const read = { playbookKey, after: undefined, types: ['run_succeeded'], definitionTypes: [] };

function succeededWith(index: number, data: Readonly<Record<string, Schema.Json>>): StoredRecord {
  return {
    id: `record-${index}`,
    causationId: null,
    correlationId: null,
    point: [String(index).padStart(6, '0')],
    stream: `${playbookKey}runs/r-${index}`,
    version: 2,
    globalPosition: index,
    type: 'run_succeeded',
    data: { ...data, record: {} },
    metadata: {
      context: {
        at,
        by: 'acme-admin',
        runId: `r-${index}`,
        definitionType: 'workflow',
        definitionName: 'report',
        definitionVersion: 1,
      },
    },
    recordedAt: at,
  };
}

async function storeAnswering(page: StoredPage): Promise<LedgerStreams> {
  const { store } = await openedOn(await onSQLite());
  return { ...store, readRecorded: () => Promise.resolve(page) };
}

async function keptOutputs(count: number, output: Schema.Json) {
  const { content } = memoryLedger().service;
  const { sha256, bytes } = await Effect.runPromise(keptIn(content, alpha, output));
  const records = Array.from({ length: count }, (_, index) =>
    succeededWith(index + 1, { output_sha256: sha256, output_bytes: bytes }),
  );
  return { records, reader: payloadReaderOf({ owner: alpha, content }), bytes };
}

function unanswering(reader: PayloadReader): PayloadReader {
  return { ...reader, json: () => Effect.fail(new Unavailable({ detail: 'The content store did not answer' })) };
}

const output = { report: 'r'.repeat(40_000) };

describe('a page of facts whose outputs their playbook keeps outside', () => {
  it('carries each output read from the playbook’s content, as the event carried it inline', async () => {
    const { records, reader } = await keptOutputs(2, output);
    const store = await storeAnswering({ records, lastExamined: { point: ['000002'], recordedAt: at } });

    const page = await Effect.runPromise(readPage(store, reader, read));

    expect(page.events.map(({ event }) => event.data)).toEqual([{ output }, { output }]);
    expect([page.contentMissing, page.atTheEnd, page.lastExamined?.point]).toEqual([[], true, ['000002']]);
  });

  it('ends where the next output would read past the bound of a page, and the next page begins after it', async () => {
    const { records, reader, bytes } = await keptOutputs(pageReadBounds.outputs + 5, output);
    const store = await storeAnswering({ records, resumeAfter: ['999999'] });

    const page = await Effect.runPromise(readPage(store, reader, read));

    expect(page.events).toHaveLength(Math.min(pageReadBounds.outputs, Math.floor(pageReadBounds.bytes / bytes)));
    expect([page.atTheEnd, page.lastExamined?.point]).toEqual([false, [String(page.events.length).padStart(6, '0')]]);
  });

  it('reads no output it would show as its size, and counts none of those toward the bound', async () => {
    const inline = Array.from({ length: pageReadBounds.outputs + 5 }, (_, index) =>
      succeededWith(index + 1, { output: index }),
    );
    const store = await storeAnswering({ records: inline });

    const page = await Effect.runPromise(readPage(store, erasingReader(alpha), read));

    expect([page.events.length, page.atTheEnd]).toEqual([pageReadBounds.outputs + 5, true]);
  });
});

describe('a page of facts whose kept outputs cannot all be read', () => {
  it('folds a missing or erased output as its size, says which were missing, and fails while the store does not answer', async () => {
    const { records, reader } = await keptOutputs(1, output);
    const store = await storeAnswering({ records });
    const emptied = payloadReaderOf({ owner: alpha, content: memoryLedger().service.content });

    const missing = await Effect.runPromise(readPage(store, emptied, read));
    const erased = await Effect.runPromise(readPage(store, erasingReader(alpha), read));
    const unavailable = await Effect.runPromise(Effect.flip(readPage(store, unanswering(reader), read)));

    expect([missing.events[0]?.event.data, erased.events[0]?.event.data]).toEqual([
      { output_bytes: JSON.stringify(output).length },
      { output_bytes: JSON.stringify(output).length },
    ]);
    expect([missing.contentMissing, erased.contentMissing]).toEqual([
      [{ record: 'record-1', type: 'run_succeeded', point: ['000001'] }],
      [],
    ]);
    expect(unavailable).toMatchObject({ _tag: 'unavailable' });
  });
});
