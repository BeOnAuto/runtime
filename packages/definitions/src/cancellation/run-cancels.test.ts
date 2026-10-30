import { Conflict, type StreamWriter } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runCanceller, type CancelRequest, type RunStreamAddress } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { toPlaybook } from '../testing/harness.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';

const relayed = { org: 'acme', playbook: 'alpha', id: relayedId };

const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: relayedId };

const deadline: CancelRequest = { kind: 'deadline', reason: 'The step that waited for it ran out of time' };

const everything = { kind: 'everything' } as const;

describe('a cancel request the workflow host records on a run', () => {
  it('is requested on a run that finishes later, by the playbook itself unless an actor is named, with the lineage given', async () => {
    const { running, ledger, run } = await withHandOn();
    await running();
    const cancel = runCanceller(ledger.service);

    const receipt = await Effect.runPromise(cancel(relayed, deadline, lineage));
    const { records } = await run(
      Effect.orDie(
        ledger.service.readRecorded({ org: 'acme', playbook: 'alpha' }, everything, { order: 'asc', limit: 20 }),
      ),
    );

    expect(receipt).toBe('requested');
    expect(records.at(-1)).toMatchObject({
      type: 'run_cancel_requested',
      ...lineage,
      data: { kind: 'deadline', reason: deadline.reason },
      context: { by: 'playbook:alpha' },
    });
  });

  it('answers that the run has ended, and records the request on a run within its call, on a run not started yet, but not at an ill-formed address', async () => {
    const { call, runDefinition, running, ledger, prober, settling } = await withHandOn();
    await running();
    await settling({ status: 'failed' });
    const plain = '0199a3c4-7d2e-7c1a-9b3f-000000000001';
    prober.sufferOnNextRun('stall');
    void call(runDefinition, toPlaybook('acme', 'alpha')(acmeAdmin, { type: 'probe', name: 'plain', run_id: plain }));
    await prober.stalled;
    const cancel = runCanceller(ledger.service);

    const addresses: readonly RunStreamAddress[] = [
      relayed,
      { ...relayed, id: plain },
      { ...relayed, id: '0199a3c4-7d2e-7c1a-9b3f-00000000ffff' },
      { ...relayed, id: 'not-a-run' },
      { ...relayed, playbook: 'al/pha' },
    ];
    const receipts = await Effect.runPromise(
      Effect.forEach(addresses, (run) => cancel(run, { ...deadline, by: 'acme-admin' }, lineage)),
    );

    expect(receipts).toEqual(['ended', 'requested', 'requested', 'unknown_run', 'unknown_run']);
  });
});

describe('a cancel request the stream refuses otherwise', () => {
  it('fails with that conflict, so it is tried again', async () => {
    const changed = new Conflict({
      detail: 'The state changed while the command was decided',
      kind: 'concurrent_change',
    });
    const changing: StreamWriter = { execute: () => Effect.fail(changed) };

    expect(await Effect.runPromise(Effect.flip(runCanceller(changing)(relayed, deadline, lineage)))).toBe(changed);
  });
});
