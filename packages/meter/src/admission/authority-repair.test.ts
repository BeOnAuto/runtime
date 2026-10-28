import { describe, expect, it } from 'vitest';

import { admitting, authorityAnswering, faultedOver, playbookObject } from '../meter-testing/cloud-metered.ts';
import { signedByAnotherKey, signedByTheTestKey } from '../testing/test-signing.ts';

function repairOf(installation: string, sign = signedByTheTestKey): ReturnType<typeof signedByTheTestKey> {
  return sign({
    v: 1,
    kind: 'repair',
    installation,
    id: crypto.randomUUID(),
    reason: 'Restored the object from a backup',
    issued_at: '2026-10-28T00:00:00.000Z',
  });
}

describe('a meter whose authority admits each action, once it finds a fault', () => {
  it('refuses every run once it finds a fault, naming the installation of its authority, and asks the authority for a repair at each run after', async () => {
    const asking = authorityAnswering(admitting);
    const metered = await faultedOver(asking);

    expect(await metered.admitted('run-3')).toEqual({
      kind: 'metering_fault',
      detail:
        'This runtime stopped starting runs because the event its meter counted last is no longer in its ledger. We need to repair it; see https://studio.on.auto/support (runtime id cloud/acme/alpha). Reading, editing and exporting still work.',
      resolve_at: 'https://studio.on.auto/support',
      runtime_id: playbookObject,
    });
    expect(asking.faults()).toEqual([]);
    expect((await metered.admitted('run-3')).kind).toBe('metering_fault');
    expect((await metered.admitted('run-4')).kind).toBe('metering_fault');
    expect(asking.asked()).toEqual(['acme/alpha/run-1', 'acme/alpha/run-2']);
    expect(asking.faults()).toEqual([
      { reason: 'history_removed', detail: 'the event its meter counted last is no longer in its ledger' },
      { reason: 'history_removed', detail: 'the event its meter counted last is no longer in its ledger' },
    ]);
  });

  it('takes the repair its authority hands it, signed by Auto for it, once, and counts again from the first event', async () => {
    const repair = repairOf(playbookObject);
    const asking = authorityAnswering(admitting, () => Promise.resolve(repair));
    const metered = await faultedOver(asking);
    const refused = await metered.admitted('run-3');

    expect(refused.kind).toBe('metering_fault');
    expect((await metered.admitted('run-3')).kind).toBe('admitted');
    expect((await metered.admitted('run-4')).kind).toBe('admitted');
    expect(await metered.state()).toMatchObject({ fault: undefined, checkpoint: { actions: 0 } });
    expect((await metered.state()).repairs).toHaveLength(1);
    expect(asking.asked()).toEqual(['acme/alpha/run-1', 'acme/alpha/run-2', 'acme/alpha/run-3', 'acme/alpha/run-4']);
    expect(asking.faults()).toHaveLength(1);
  });

  it('refuses as metering_fault when its authority cannot be asked for a repair', async () => {
    const asking = authorityAnswering(admitting, () => Promise.reject(new Error('Unbound')));
    const metered = await faultedOver(asking);
    await metered.admitted('run-3');

    expect((await metered.admitted('run-3')).kind).toBe('metering_fault');
    expect(asking.faults()).toHaveLength(1);
  });
});

describe('a meter whose authority hands it a repair Auto did not sign for it', () => {
  it.each([
    ['for another playbook', () => repairOf('cloud/acme/beta')],
    ['signed by a key Auto does not hold', () => repairOf(playbookObject, signedByAnotherKey('auto-2026-10'))],
  ])('ignores a repair %s, and its fault stands', async (_, repair) => {
    const metered = await faultedOver(authorityAnswering(admitting, () => Promise.resolve(repair())));
    await metered.admitted('run-3');

    expect((await metered.admitted('run-3')).kind).toBe('metering_fault');
    expect(await metered.state()).toMatchObject({ fault: { reason: 'history_removed' }, repairs: [] });
  });
});
