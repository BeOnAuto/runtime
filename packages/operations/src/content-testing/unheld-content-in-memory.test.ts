import { memoryContentStore } from '@on.auto/content/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { memoryLedger } from '../testing/memory-ledger.ts';
import { firstNotes, kept, noted } from './held-notes.ts';
import { interleavedRemovalBehaviour } from './interleaved-removal-behaviour.ts';
import { unheldContentBehaviour } from './unheld-content-behaviour.ts';

unheldContentBehaviour({ aLedger: (holders) => Promise.resolve(memoryLedger(undefined, [], holders).service) });

interleavedRemovalBehaviour({
  aStore: () => Promise.resolve(memoryContentStore()),
  aLedger: (holders, store) => Promise.resolve(memoryLedger(undefined, [], holders, store).service),
});

describe('the in-memory ledger opened without the facts that hold content', () => {
  it('records a holding fact as any other, and removes no content, as a defect', async () => {
    const { service } = memoryLedger();
    await noted(service, firstNotes, kept('a'.repeat(64)));

    const removal = await Effect.runPromise(
      Effect.catchDefect(service.removeUnheld({ org: 'acme', playbook: 'alpha' }, 'a'.repeat(64)), (defect) =>
        Effect.succeed(String(defect)),
      ),
    );

    expect(removal).toBe(
      'Error: The ledger was opened without the facts that hold content, so it cannot tell a held content from an unheld one and removes none',
    );
  });
});
