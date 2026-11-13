import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RecordedStore, StoredRecord } from '../event-store.ts';
import type { RecordedKeys } from '../keys/recorded-keys.ts';
import { recordedEventReaderOf, recordedReaderOf } from './recorded-reader.ts';

const at = '2026-10-05T09:00:00.000Z';

const context = { at, by: 'tester' };

const untraced: StoredRecord = {
  id: 'message-21',
  causationId: null,
  correlationId: 'r1',
  point: ['21'],
  stream: 'playbook/acme/alpha/runs/r1',
  version: 1,
  globalPosition: 21,
  type: 'run_started',
  data: { input: {} },
  metadata: { context },
  recordedAt: at,
};

interface Holding {
  readonly store: RecordedStore;
  readonly asked: readonly RecordedKeys[];
}

function storeHolding(record: StoredRecord): Holding {
  const asked: RecordedKeys[] = [];
  const store: RecordedStore = {
    pointLength: 1,
    readRecorded: () => Promise.reject(new Error('A read by the text of a key is not asked here')),
    readAppended: () => Promise.resolve({ streams: [], through: ['21'], more: false }),
    readAppendedFacts: () => Promise.resolve({ held: false }),
    readRecordedEvent: () => Promise.reject(new Error('A read by the text of a key is not asked here')),
    readRecordedOfKeys: (keys) => {
      asked.push(keys);
      return Promise.resolve({ records: [record] });
    },
    readRecordedEventOfKeys: (keys, id) => {
      asked.push(keys);
      return Promise.resolve(id === record.id ? record : undefined);
    },
  };
  return { store, asked };
}

const alpha = { org: 'acme', playbook: 'alpha' };

const theKeysOfAlpha: RecordedKeys = { org: 'acme', keys: ['playbook/acme/alpha/'] };

describe('the reads of a playbook', () => {
  it("ask the store for the playbook's key under the org its address names", async () => {
    const { store, asked } = storeHolding(untraced);

    const page = await Effect.runPromise(
      recordedReaderOf(store)(alpha, { kind: 'correlated', correlation: 'r1' }, { order: 'desc', limit: 5 }),
    );
    await Effect.runPromise(recordedEventReaderOf(store)(alpha, 'message-21'));

    expect(page.records.map(({ id }) => id)).toEqual(['message-21']);
    expect(asked).toEqual([theKeysOfAlpha, theKeysOfAlpha]);
  });
});

describe('one record read by its id', () => {
  it('carries no page cursor, no trace and no span when its store kept none, and is nothing for an id the store does not hold', async () => {
    const read = recordedEventReaderOf(storeHolding(untraced).store);

    const [found, missing] = await Effect.runPromise(
      Effect.all([read(alpha, 'message-21'), read(alpha, 'message-99')]),
    );

    expect(found).toEqual({
      id: 'message-21',
      causationId: null,
      correlationId: 'r1',
      stream: 'playbook/acme/alpha/runs/r1',
      version: 1,
      globalPosition: 21,
      type: 'run_started',
      data: { input: {} },
      context,
      recordedAt: at,
    });
    expect(missing).toBeUndefined();
  });
});
