import { expect, it } from 'vitest';

import { digestOf } from '../counting/checkpoint-digest.ts';
import type { Tampering } from '../testing/ledgers.ts';
import type { Metered } from '../testing/metered.ts';
import { runOf } from '../testing/runs.ts';
import { checkpointOf, opened, restartedOf, startedOnceAdmitted, type LedgerOf } from './opened.ts';

const installation = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

async function licensedOn(ledgerOf: LedgerOf) {
  const { metered, ...rest } = await opened(ledgerOf);
  const key = metered.account.keyFor(installation);
  await metered.activated(key);
  return { ...rest, metered, key };
}

async function forgedTo(actions: number, metered: Metered, tampering: Tampering): Promise<void> {
  const { through, last } = { through: [], last: '', ...(await checkpointOf(metered)) };
  const forged = { actions, through, last };
  const [id = ''] = (await tampering.idsOf('meter')).toReversed();
  await tampering.edited(id, (data) => ({ ...data, ...forged, digest: digestOf(forged) }));
}

export function reportBehaviour(ledgerOf: LedgerOf): void {
  it('reports the count it projected with the id of its checkpoint’s last event, and records it, with its point, once taken', async () => {
    const { metered } = await licensedOn(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await startedOnceAdmitted(metered, 'run-2');

    expect(await metered.reported()).toEqual({ kind: 'reported', detail: '' });
    const { checkpoint, reported } = await metered.state();
    expect(metered.account.reports()).toEqual([{ actions: 2, last: checkpoint?.last }]);
    expect(reported).toEqual({ actions: 2, through: checkpoint?.through, last: checkpoint?.last });
  });

  it('reports again each time it is asked, the count at the head of its ledger', async () => {
    const { metered } = await licensedOn(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await metered.reported();
    await startedOnceAdmitted(metered, 'run-2');
    await metered.reported();
    const [first, second] = metered.account.reports();

    expect([first?.actions, second?.actions]).toEqual([1, 2]);
    expect(second?.last).not.toBe(first?.last);
  });

  it('is asked again until the account takes it, and sends a report taken but not recorded again', async () => {
    const { metered } = await licensedOn(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    metered.account.goDown();
    const unreached = await metered.reported();
    metered.account.comeBack();
    metered.executesFail('conflict');
    const unrecorded = await metered.reported();
    metered.executesFail('nothing');

    expect([unreached.kind, unrecorded.kind]).toEqual(['meter_unavailable', 'meter_unavailable']);
    expect(await metered.reported()).toEqual({ kind: 'reported', detail: '' });
    expect([metered.account.reports().length, metered.account.reportsSent()]).toEqual([1, 2]);
    expect((await metered.state()).reported?.actions).toBe(1);
  });
}

export function reportVerificationBehaviour(ledgerOf: LedgerOf): void {
  it('verifies its count against the whole ledger before every report, and reports what the ledger holds', async () => {
    const { metered, tampering } = await licensedOn(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await startedOnceAdmitted(metered, 'run-2');
    await metered.admitted(runOf('run-3'));
    await forgedTo(0, metered, tampering);
    await metered.reported();

    expect(metered.account.reports().map(({ actions }) => actions)).toEqual([2]);
    expect(metered.warnings()).toContain("The meter's count of 0 actions was edited; its ledger holds 2");
  });

  it('reports nothing without a key, nor once its key was revoked, which it records', async () => {
    const { metered, key } = await licensedOn(ledgerOf);
    const unlicensed = await opened(ledgerOf);
    await startedOnceAdmitted(unlicensed.metered, 'run-1');
    await startedOnceAdmitted(metered, 'run-1');
    metered.account.revoke(key);

    expect([await metered.reported(), await unlicensed.metered.reported()]).toEqual([
      { kind: 'reported', detail: '' },
      { kind: 'reported', detail: '' },
    ]);
    expect((await metered.state()).license?.invalid?.detail).toContain('revoked');
    expect(await metered.reported()).toEqual({ kind: 'reported', detail: '' });
    expect(metered.account.reportsSent() + unlicensed.metered.account.reportsSent()).toBe(0);
  });

  it('reports nothing while a fault stands, or when it finds one as it verifies its count, and starts no run after', async () => {
    const { metered, tampering, key } = await licensedOn(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await metered.admitted(runOf('run-2'));
    await tampering.deleted(await metered.lastCounted());
    const found = await metered.reported();
    const restarted = await restartedOf(metered, { key });

    expect([found, await restarted.reported()]).toEqual([
      { kind: 'reported', detail: '' },
      { kind: 'reported', detail: '' },
    ]);
    expect(metered.account.reportsSent()).toBe(0);
    expect((await restarted.admitted(runOf('run-3'))).kind).toBe('metering_fault');
  });
}
