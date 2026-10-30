import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runCanceller } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { toPlaybook, type LedgerRead } from '../testing/harness.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const childId = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

const unknownId = '0199a3c4-7d2e-7c1a-9b3f-0000000000d1';

const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: childId };

const pageOf = (run: string, page: object) => ({ selection: { kind: 'run', run }, page });

const newestHeadOf = (run: string) => pageOf(run, { order: 'desc', limit: 1, dataOf: [] });

async function readsOf<A>(ledgerReads: () => readonly LedgerRead[], read: () => Promise<A>) {
  const before = ledgerReads().length;
  const answer = await read();
  return { answer, reads: ledgerReads().slice(before) };
}

describe('a page of the history of a run', () => {
  it('reads the page alone, however large the run, and never the whole run', async () => {
    const handed = await withHandOn();
    await handed.running(262_000);

    const { answer, reads } = await readsOf(handed.ledgerReads, handed.history);

    expect(answer).toMatchObject({ status: 'succeeded' });
    expect(reads).toEqual([pageOf(relayedId, { order: 'asc', limit: 100 })]);
  });

  it('that holds nothing but a cancel reads the newest head of the run, without its data, to tell it holds a run', async () => {
    const handed = await withHandOn();
    await handed.running();
    await handed.cancelling({ reason: 'Not needed' });

    const { answer, reads } = await readsOf(handed.ledgerReads, () =>
      handed.call(handed.getRunHistory, toAlpha(acmeAdmin, { run_id: relayedId, order: 'desc', limit: 1 })),
    );

    expect(answer).toMatchObject({ status: 'succeeded', output: { events: [{ type: 'run_cancel_requested' }] } });
    expect(reads).toEqual([pageOf(relayedId, { order: 'desc', limit: 1 }), newestHeadOf(relayedId)]);
  });

  it('of a stream that holds its caller’s cancel alone, or of no stream, is not found, from one head read', async () => {
    const handed = await withHandOn();
    await Effect.runPromise(
      runCanceller(handed.ledger.service)(
        { org: 'acme', playbook: 'alpha', id: childId },
        { kind: 'parent_ended', reason: 'The run that waited for it ended first' },
        lineage,
      ),
    );
    const historyOf = (id: string) => () => handed.call(handed.getRunHistory, toAlpha(acmeAdmin, { run_id: id }));

    const cancelledFirst = await readsOf(handed.ledgerReads, historyOf(childId));
    const unknown = await readsOf(handed.ledgerReads, historyOf(unknownId));

    expect([cancelledFirst.answer, unknown.answer]).toMatchObject([
      { status: 'rejected', reason: 'not_found' },
      { status: 'rejected', reason: 'not_found' },
    ]);
    expect([cancelledFirst.reads, unknown.reads]).toEqual([
      [pageOf(childId, { order: 'asc', limit: 20 }), newestHeadOf(childId)],
      [pageOf(unknownId, { order: 'asc', limit: 20 }), newestHeadOf(unknownId)],
    ]);
  });
});
