import { expect, it } from 'vitest';

import { runOf } from '../testing/runs.ts';
import { allocatedOn, opened, restartedOf, startedOnceAdmitted, type LedgerOf } from './opened.ts';

const installation = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const page = `https://studio.on.auto/licenses?installation=${installation}`;

const aWeekAndADayLater = '2026-11-04T12:00:00.000Z';

const noLicense = { org: null, org_name: null, plan: null, expires_at: null, renewed_at: null };

async function keyedOn(ledgerOf: LedgerOf, keySource: 'environment' | 'configuration' = 'environment') {
  const { metered, ...rest } = await opened(ledgerOf);
  const key = metered.account.keyFor(installation, 'globex');
  return { ...rest, metered: await restartedOf(metered, { key, keySource }), key };
}

function unregisteredStatusBehaviour(ledgerOf: LedgerOf): void {
  it('reads unregistered with no run used, identifying its installation once, which its first admission keeps', async () => {
    const { metered } = await opened(ledgerOf);
    const first = await metered.status();
    const again = await metered.status();
    await metered.admitted(runOf('run-1'));

    expect(first).toEqual({
      state: 'unregistered',
      runtime_id: again.runtime_id,
      free_runs: { used: 0, of: 100 },
      ...noLicense,
      key_source: null,
      offline: null,
      fault: null,
      invalid_because: null,
    });
    expect((await metered.state()).installation).toBe(first.runtime_id);
  });
}

function countedStatusBehaviour(ledgerOf: LedgerOf): void {
  it('counts the free runs it used from its ledger, at most its allowance', async () => {
    const { metered } = await opened(ledgerOf, { allowance: 2 });
    await startedOnceAdmitted(metered, 'run-1');
    const afterOne = await metered.status();
    await startedOnceAdmitted(metered, 'run-2');
    await metered.started('run-3');

    expect([afterOne.free_runs, (await metered.status()).free_runs]).toEqual([
      { used: 1, of: 2 },
      { used: 2, of: 2 },
    ]);
  });

  it('counts what it last checkpointed while its ledger cannot be read, or while a fault stands', async () => {
    const { metered, tampering } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await metered.admitted(runOf('run-2'));
    await metered.started('run-2');
    const restarted = await restartedOf(metered);
    restarted.readsFail();
    const unread = await restarted.status();
    const faulting = await restartedOf(restarted);
    await faulting.admitted(runOf('run-3'));
    await tampering.deleted(await faulting.lastCounted());
    await faulting.admitted(runOf('run-4'));

    expect([unread.free_runs.used, (await faulting.status()).free_runs.used]).toEqual([2, 2]);
  });

  it('refuses as meter_unavailable when it cannot record the installation it identifies', async () => {
    const { metered } = await opened(ledgerOf);
    metered.executesFail('conflict');
    const lost = await metered.refusedStatus();
    metered.executesFail('defect');

    expect([lost.kind, (await metered.refusedStatus()).kind]).toEqual(['meter_unavailable', 'meter_unavailable']);
  });
}

function faultStatusBehaviour(ledgerOf: LedgerOf): void {
  it('names a standing fault in the words each new run is refused in, and no fault before it', async () => {
    const { metered, tampering } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await metered.admitted(runOf('run-2'));
    const before = await metered.status();
    await tampering.deleted(await metered.lastCounted());
    const refused = await metered.admitted(runOf('run-3'));

    expect(before.fault).toBeNull();
    expect(refused.kind).toBe('metering_fault');
    expect((await metered.status()).fault).toBe(refused.detail);
  });
}

function licensedStatusBehaviour(ledgerOf: LedgerOf): void {
  it('reads a key it has not activated yet as invalid, by the installation the key names, and where the key came from', async () => {
    const { metered } = await keyedOn(ledgerOf, 'configuration');

    expect(await metered.status()).toEqual({
      state: 'invalid',
      runtime_id: installation,
      free_runs: { used: 0, of: 100 },
      ...noLicense,
      key_source: 'configuration',
      offline: null,
      fault: null,
      invalid_because:
        'This runtime holds a key it has not activated yet. It activates it with Auto as it starts its next run; check that it can reach billing.on.auto.',
    });
    expect((await metered.state()).installation).toBeUndefined();
  });

  it('reads licensed once its key is activated, with the org, the plan and when Auto renewed and ends it', async () => {
    const { metered } = await keyedOn(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');

    expect(await metered.status()).toEqual({
      state: 'licensed',
      runtime_id: installation,
      free_runs: { used: 1, of: 100 },
      org: 'globex',
      org_name: null,
      plan: 'free',
      expires_at: '2026-11-03T12:00:00.000Z',
      renewed_at: '2026-10-27T12:00:00.000Z',
      key_source: 'environment',
      offline: null,
      fault: null,
      invalid_because: null,
    });
  });

  it('reads a key activated through it as activated', async () => {
    const { metered } = await opened(ledgerOf);
    await metered.activated(metered.account.keyFor(installation));

    expect(await metered.status()).toMatchObject({ state: 'licensed', key_source: 'activated' });
  });
}

function namedStatusBehaviour(ledgerOf: LedgerOf): void {
  it('reads the name of its org that Auto signed, through a restart', async () => {
    const { metered } = await opened(ledgerOf);
    metered.account.orgNamed('globex', 'Globex Corporation');
    const key = metered.account.keyFor(installation, 'globex');
    await metered.activated(key);
    const restarted = await restartedOf(metered, { key: undefined });
    await restarted.held(key);

    expect(await restarted.status()).toMatchObject({
      state: 'licensed',
      org: 'globex',
      org_name: 'Globex Corporation',
    });
  });
}

function invalidStatusBehaviour(ledgerOf: LedgerOf): void {
  it('reads invalid in the words of the refusal once the account says its key was rotated', async () => {
    const { metered, key } = await keyedOn(ledgerOf);
    await metered.admitted(runOf('run-1'));
    metered.account.revoke(key, 'key_rotated');
    await metered.admitted(runOf('run-2'));

    expect(await metered.status()).toMatchObject({
      state: 'invalid',
      org: 'globex',
      fault: null,
      invalid_because: `This runtime's key was replaced. Activate the new key an owner was shown when they rotated it, then run this again. If the key is lost, an owner can rotate it again at ${page}.`,
    });
  });

  it('reads invalid once its entitlement is past its end, saying it was not renewed', async () => {
    const { metered } = await keyedOn(ledgerOf);
    await metered.admitted(runOf('run-1'));
    metered.at(aWeekAndADayLater);

    expect(await metered.status()).toMatchObject({
      state: 'invalid',
      expires_at: '2026-11-03T12:00:00.000Z',
      fault: null,
      invalid_because:
        "This runtime's license wasn't renewed by 2026-11-03. Check that it can reach billing.on.auto (it renews every day), then run this again.",
    });
  });
}

function offlineStatusBehaviour(ledgerOf: LedgerOf): void {
  it('reads offline with the credits of its allocation, what it spent of them and until when they may be used', async () => {
    const { metered } = await allocatedOn(ledgerOf, 5, false);
    await startedOnceAdmitted(metered, 'run-1');
    await startedOnceAdmitted(metered, 'run-2');

    expect(await metered.status()).toMatchObject({
      state: 'offline',
      runtime_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7f',
      key_source: null,
      offline: { credits: 5, spent: 2, usable_until: '2026-11-03T12:00:00.000Z' },
      fault: null,
      invalid_because: null,
    });
  });

  it('reads invalid once its offline credits stopped, still giving them', async () => {
    const { metered } = await allocatedOn(ledgerOf, 5);
    metered.at(aWeekAndADayLater);

    expect(await metered.status()).toMatchObject({
      state: 'invalid',
      key_source: 'environment',
      offline: { credits: 5, spent: 0, usable_until: '2026-11-03T12:00:00.000Z' },
      fault: null,
      invalid_because:
        'These offline credits stopped on 2026-11-03. An owner can request new ones at https://studio.on.auto/licenses?installation=0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7f.',
    });
  });
}

export function statusBehaviour(ledgerOf: LedgerOf): void {
  unregisteredStatusBehaviour(ledgerOf);
  countedStatusBehaviour(ledgerOf);
  faultStatusBehaviour(ledgerOf);
  licensedStatusBehaviour(ledgerOf);
  namedStatusBehaviour(ledgerOf);
  invalidStatusBehaviour(ledgerOf);
  offlineStatusBehaviour(ledgerOf);
}
