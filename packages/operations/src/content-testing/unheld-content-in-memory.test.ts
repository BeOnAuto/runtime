import { alpha, memoryContentStore } from '@on.auto/content/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { LedgerPorts } from '../ledger/ledger.ts';
import type { KeyedProjection } from '../projections/keyed-projection.ts';
import type { RunOutcomeMapping } from '../run-outcomes/run-outcomes.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';
import { anHour, firstNotes, heldNotes, kept, keptAt, keptIn, noteHolders, noted, removedAt } from './held-notes.ts';
import { interleavedRemovalBehaviour } from './interleaved-removal-behaviour.ts';
import { unheldContentBehaviour } from './unheld-content-behaviour.ts';

unheldContentBehaviour({ aLedger: (holders) => Promise.resolve(memoryLedger(undefined, [], holders).service) });

interleavedRemovalBehaviour({
  aStore: () => Promise.resolve(memoryContentStore()),
  aLedger: (holders, store) => Promise.resolve(memoryLedger(undefined, [], holders, store).service),
});

interface AppendingLedger {
  readonly ledger: LedgerPorts;
  readonly stream: string;
}

const breakingOnNotes = (): never => {
  throw new Error('The table broke down');
};

describe('the in-memory ledger whose outcomes of runs or whose projection throws at an append', () => {
  it('keeps nothing of the append, the holds of its facts among them, so their content is removed once its hour has passed', async () => {
    const throwingMapping: RunOutcomeMapping = { types: ['note_kept'], rowAfter: breakingOnNotes };
    const throwingProjection: KeyedProjection = {
      name: 'notes',
      version: 1,
      kinds: ['notes'],
      types: ['note_kept'],
      columns: [],
      indexes: [],
      rowAfter: breakingOnNotes,
    };
    const ledgers: readonly AppendingLedger[] = [
      { ledger: memoryLedger(throwingMapping, [], noteHolders).service, stream: 'playbook/acme/alpha/runs/r1' },
      { ledger: memoryLedger(undefined, [throwingProjection], noteHolders).service, stream: firstNotes },
    ];

    const removed = await Promise.all(
      ledgers.map(async ({ ledger, stream }: AppendingLedger) => {
        const sha256 = await keptIn(ledger, alpha, '{"note":"refused"}', keptAt);
        const exit = await Effect.runPromiseExit(ledger.execute(stream, heldNotes, [kept(sha256)]));
        return [Exit.hasDies(exit), await removedAt(ledger, keptAt + 2 * anHour, alpha, sha256)];
      }),
    );

    expect(removed).toEqual([
      [true, 'removed'],
      [true, 'removed'],
    ]);
  });
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
