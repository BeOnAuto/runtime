import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runCanceller, type CancelRequest } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { toPlaybook } from '../testing/harness.ts';
import { withHandOn } from '../testing/relaying.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const childId = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

const child = { org: 'acme', playbook: 'alpha', id: childId };

const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: childId };

const parentEnded: CancelRequest = { kind: 'parent_ended', reason: 'The run that waited for it ended first' };

describe('a cancel by the caller of a run that has not started', () => {
  it('is the first record of its stream, so the start that lands after it is rejected as cancelled and runs nothing', async () => {
    const { call, runDefinition, getRun, cancelRun, ledger, relayer } = await withHandOn();
    const cancel = runCanceller(ledger.service);

    const receipt = await Effect.runPromise(cancel(child, parentEnded, lineage));
    const started = await call(
      runDefinition,
      toAlpha(acmeAdmin, { type: 'relay', name: 'hand-on', input: {}, run_id: childId }),
    );
    const read = await call(getRun, toAlpha(acmeAdmin, { run_id: childId }));
    const again = await Effect.runPromise(cancel(child, parentEnded, lineage));

    expect(receipt).toBe('requested');
    expect(started).toMatchObject({
      status: 'rejected',
      reason: 'cancelled',
      kind: 'parent_ended',
      detail: parentEnded.reason,
    });
    expect([relayer.runs(), read]).toMatchObject([0, { status: 'rejected', reason: 'not_found' }]);
    expect(again).toBe('requested');
    expect(await call(cancelRun, toAlpha(acmeAdmin, { run_id: childId }))).toMatchObject({
      status: 'rejected',
      reason: 'not_found',
    });
  });
});

describe('the stream of a run its caller cancelled before it started', () => {
  it('holds no run: the list leaves it out, filtered or not, and the run and its history are not found', async () => {
    const { call, getRun, getRunHistory, listRuns, ledger } = await withHandOn();
    await Effect.runPromise(runCanceller(ledger.service)(child, parentEnded, lineage));

    const filters: readonly Readonly<Record<string, string>>[] = [{}, { status: 'started' }, { type: 'relay' }];
    const listed = await Promise.all(filters.map((filter) => call(listRuns, toAlpha(acmeAdmin, filter))));
    const read = await call(getRun, toAlpha(acmeAdmin, { run_id: childId }));
    const history = await call(getRunHistory, toAlpha(acmeAdmin, { run_id: childId }));

    expect(listed).toEqual(
      listed.map(() => ({ status: 'succeeded', output: { runs: [], has_more: false, next_cursor: null } })),
    );
    expect([read, history]).toMatchObject([
      { status: 'rejected', reason: 'not_found' },
      { status: 'rejected', reason: 'not_found' },
    ]);
  });
});

describe('a run within its call that its caller cancels and then interrupts', () => {
  it('ends rejected as cancelled with the kind of the cancel, not failed', async () => {
    const { call, callCancelledWhen, runDefinition, getRun, ledger, prober } = await withHandOn();
    const cancel = runCanceller(ledger.service);
    prober.sufferOnNextRun('stall');
    const cancelled = prober.stalled.then(() => Effect.runPromise(cancel(child, parentEnded, lineage)));

    const settled = await callCancelledWhen(
      cancelled,
      runDefinition,
      toAlpha(acmeAdmin, { type: 'probe', name: 'plain', input: {}, run_id: childId }),
    );
    const read = await call(getRun, toAlpha(acmeAdmin, { run_id: childId }));

    expect(settled).toEqual({ status: 'cancelled' });
    expect(read).toMatchObject({
      output: {
        status: 'rejected',
        rejection: { reason: 'cancelled', kind: 'parent_ended', detail: parentEnded.reason },
      },
    });
  });

  it('ends failed when nothing asked for its cancel before it was interrupted', async () => {
    const { call, callCancelledWhen, runDefinition, getRun, prober } = await withHandOn();
    prober.sufferOnNextRun('stall');

    await callCancelledWhen(
      prober.stalled,
      runDefinition,
      toAlpha(acmeAdmin, { type: 'probe', name: 'plain', input: {}, run_id: childId }),
    );

    expect(await call(getRun, toAlpha(acmeAdmin, { run_id: childId }))).toMatchObject({
      output: { status: 'failed' },
    });
  });
});
