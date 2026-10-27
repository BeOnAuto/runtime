import { expect, it } from 'vitest';

import type { Answering } from '../testing/account-fake.ts';
import { runOf } from '../testing/runs.ts';
import { opened, restartedAfter, restartedOf, startedOnceAdmitted, type LedgerOf } from './opened.ts';

const installation = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7d';

async function licensedThenLosing(ledgerOf: LedgerOf) {
  const { metered, tampering } = await opened(ledgerOf);
  const key = metered.account.keyFor(installation);
  await metered.activated(key);
  await startedOnceAdmitted(metered, 'run-1');
  await metered.admitted(runOf('run-2'));
  const counted = await metered.lastCounted();
  return { metered: await restartedAfter(metered, () => tampering.deleted(counted), { key }), key };
}

const notAuto: readonly (readonly [string, Answering])[] = [
  ['signed by another key under the kid of Auto’s', 'by another key'],
  ['signed by a key Auto does not hold', 'by an unknown key'],
  ['for another installation', 'for another installation'],
  ['tampered with after it was signed', 'tampered'],
];

export function repairBehaviour(ledgerOf: LedgerOf): void {
  it('takes a repair Auto signed for it, which clears its fault and counts again from the first event, once', async () => {
    const { metered, key } = await licensedThenLosing(ledgerOf);
    const refused = await metered.admitted(runOf('run-3'));
    metered.account.repairFor(installation);
    await metered.refreshed();
    await metered.refreshed();

    expect(refused.kind).toBe('metering_fault');
    expect(await metered.state()).toMatchObject({ fault: undefined, checkpoint: { actions: 0 } });
    expect((await metered.state()).repairs).toHaveLength(1);
    expect(metered.account.activations().map(({ actions }) => actions)).toEqual([0, 1, 0]);
    expect((await metered.admitted(runOf('run-3'))).kind).toBe('admitted');
    const restarted = await restartedOf(metered, { key });
    expect((await restarted.admitted(runOf('run-4'))).kind).toBe('admitted');
    expect(restarted.warnings()).toEqual([]);
  });

  it('activates while the fault it finds as it counts stands, and so takes the repair waiting for it', async () => {
    const { metered, tampering } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await metered.admitted(runOf('run-2'));
    await tampering.deleted(await metered.lastCounted());
    const { installation: identified = '' } = await metered.state();
    metered.account.repairFor(identified);

    expect((await metered.activated(metered.account.keyFor(identified))).kind).toBe('activated');
    expect(await metered.state()).toMatchObject({ fault: undefined, license: { installation: identified } });
    expect(metered.warnings()).toContain(
      'Auto repaired the meter, which counted its ledger again from the first event: Restored from a backup',
    );
  });

  it.each(notAuto)('ignores a repair %s, and its fault stands', async (_, how) => {
    const { metered } = await licensedThenLosing(ledgerOf);
    await metered.admitted(runOf('run-3'));
    metered.account.repairFor(installation, how);
    await metered.refreshed();

    expect((await metered.admitted(runOf('run-3'))).kind).toBe('metering_fault');
    expect(metered.warnings()).toContain('The meter ignored a repair that Auto did not sign for this installation');
  });
}
