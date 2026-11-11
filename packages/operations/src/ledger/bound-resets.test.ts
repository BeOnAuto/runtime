import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { memoryLedger } from '../testing/memory-ledger.ts';
import { playbookReaderOf } from './playbook-ledger.ts';

describe('the reset of a stream projection through the reader of a playbook', () => {
  it('resets the rows of the playbook the reader is bound to', async () => {
    const reset: unknown[] = [];
    const reader = playbookReaderOf(
      {
        ...memoryLedger().service,
        resetStreamProjection: (projection, address) =>
          Effect.sync(() => {
            reset.push([projection, address]);
          }),
      },
      { org: 'acme', playbook: 'alpha' },
    );

    await Effect.runPromise(reader.resetStreamProjection('labelled'));

    expect(reset).toEqual([['labelled', { org: 'acme', playbook: 'alpha' }]]);
  });
});
