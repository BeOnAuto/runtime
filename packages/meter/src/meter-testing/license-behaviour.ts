import { expect, it } from 'vitest';

import type { Answering } from '../testing/account-fake.ts';
import { runOf } from '../testing/runs.ts';
import {
  admittedEach,
  licensedInstallation,
  licensedOn,
  opened,
  restartedAfter,
  restartedOf,
  runsNamed,
  startedOnceAdmitted,
  type LedgerOf,
} from './opened.ts';
import { closedAccountBehaviour, fallbackWordsBehaviour, keptWordingBehaviour } from './refusal-behaviour.ts';

const installation = licensedInstallation;

function activationBehaviour(ledgerOf: LedgerOf): void {
  it('activates a key with its count, records the license Auto signed, and admits each run locally against it', async () => {
    const { metered } = await opened(ledgerOf);
    const key = metered.account.keyFor(installation, 'globex');

    expect(await metered.activated(key)).toEqual({ kind: 'activated', detail: '' });
    expect(await admittedEach(metered, ['run-1', 'run-2'])).toEqual(['admitted', 'admitted']);
    expect(metered.account.activations()).toEqual([{ installation, actions: 0, licensed: 0 }]);
    expect(metered.account.reportsSent()).toBe(0);
    expect(await metered.state()).toMatchObject({
      installation,
      admitted: { actions: 2, licensed: 2, first_runs: 0 },
      license: {
        installation,
        org: 'globex',
        plan: 'free',
        policy: '2026-10-28',
        issued_at: '2026-10-27T12:00:00.000Z',
        warn_at: '2026-11-10T12:00:00.000Z',
        limit_at: '2026-11-24T12:00:00.000Z',
        charged_through: 0,
        admits_through: 1000,
        standing: 'ok',
        credits: { available: 1000, owed: 0, overage_cap: 0 },
        fallback: { per_day: 15, per_month: 75 },
        licensed_reported: 0,
        taken_at: '2026-10-27T12:00:00.000Z',
      },
    });
  });

  it('activates the key it was given as it starts at its first report, running its first runs until then', async () => {
    const { metered } = await opened(ledgerOf);
    const key = metered.account.keyFor(installation);
    const keyed = await restartedOf(metered, { key });
    await startedOnceAdmitted(keyed, 'run-1');
    await keyed.reported();
    await startedOnceAdmitted(keyed, 'run-2');

    expect(keyed.account.activations()).toEqual([{ installation, actions: 1, licensed: 0 }]);
    expect((await keyed.state()).admitted).toMatchObject({ actions: 2, first_runs: 1, licensed: 1 });
  });
}

function keptLicenseBehaviour(ledgerOf: LedgerOf): void {
  it('keeps its license through a restart, admitting against it with no call to Auto, and with a key handed to it again', async () => {
    const { metered, key } = await licensedOn(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    const restarted = await restartedOf(metered, { key: undefined });
    await restarted.held(key);
    metered.account.goDown();

    expect(await startedOnceAdmitted(restarted, 'run-2')).toBe('admitted');
    expect((await restarted.state()).admitted.licensed).toBe(2);
    expect(metered.account.activations()).toHaveLength(1);
  });

  it('takes as the floor of its licensed count what Auto charged already, so a wiped ledger with the same key gains nothing', async () => {
    const { metered, tampering, key } = await licensedOn(ledgerOf);
    await admittedEach(metered, runsNamed('run', 3));
    await metered.reported();
    const wiped = await restartedAfter(metered, () => tampering.streamDeleted('meter'), { key });
    await wiped.reported();
    await startedOnceAdmitted(wiped, 'later');
    await wiped.reported();

    expect(wiped.account.activations().at(-1)).toEqual({ installation, actions: 0, licensed: 0 });
    expect((await wiped.state()).admitted).toMatchObject({ actions: 4, licensed: 4, first_runs: 0 });
    expect(wiped.account.chargedThrough(installation)).toBe(4);
    expect(wiped.account.wentBackwards()).toEqual([]);
  });

  it('refuses as meter_unavailable an activation while Auto cannot be reached, or its license cannot be recorded', async () => {
    const { metered } = await opened(ledgerOf);
    const key = metered.account.keyFor(installation);
    metered.account.goDown();
    const unreached = await metered.activated(key);
    metered.account.comeBack();
    metered.executesFail('conflict');

    expect([unreached.kind, (await metered.activated(key)).kind]).toEqual(['meter_unavailable', 'meter_unavailable']);
  });
}

function licensedAdmissionBehaviour(ledgerOf: LedgerOf): void {
  it('admits while its licensed count is below what the license admits through, then at the free rate, charging none of those', async () => {
    const { metered } = await opened(ledgerOf);
    metered.account.fund('acme', { available: 2 });
    metered.account.policy({ per_day: 1, per_month: 5 });
    const key = metered.account.keyFor(installation);
    await metered.activated(key);
    const admitted = await admittedEach(metered, runsNamed('run', 3));
    const refused = await metered.admitted(runOf('run-3'));
    await metered.reported();

    expect(admitted).toEqual(['admitted', 'admitted', 'admitted']);
    expect(refused).toMatchObject({ kind: 'credits_exhausted', because: 'free_daily_limit' });
    expect((await metered.state()).admitted).toMatchObject({ actions: 3, licensed: 2, first_runs: 0 });
    expect(metered.account.reports()).toEqual([{ actions: 3, licensed: 2 }]);
    expect(metered.account.chargedThrough(installation)).toBe(2);
  });

  it('takes the free rate its license carries, and runs no first runs again once it has held a license', async () => {
    const { metered, key } = await licensedOn(ledgerOf);
    metered.account.policy({ per_day: 2, per_month: 2 });
    metered.account.fund('acme', { available: 0 });
    await metered.reported();
    const keyless = await restartedOf(metered, { key: undefined });
    const free = await admittedEach(keyless, ['run-1', 'run-2']);
    const refused = await keyless.admitted(runOf('run-3'));

    expect(free).toEqual(['admitted', 'admitted']);
    expect(refused).toMatchObject({ kind: 'license_required', because: 'free_month_used' });
    expect(refused.detail).toMatch(
      /^This runtime holds no key, so it runs at the free rate of 2 runs a UTC day and 2 a UTC month\./u,
    );
    expect(key).toContain(installation);
  });
}

function timeBehaviour(ledgerOf: LedgerOf): void {
  it('admits on its license after the day Auto warns from, and at the free rate from the day it limits from', async () => {
    const { metered } = await licensedOn(ledgerOf, {}, (account) => {
      account.policy({ per_day: 0, per_month: 0 });
    });
    metered.account.goDown();
    metered.at('2026-11-23T12:00:00.000Z');
    const warned = await startedOnceAdmitted(metered, 'run-1');
    metered.at('2026-11-24T12:00:00.000Z');
    const limited = await metered.admitted(runOf('run-2'));

    expect(warned).toBe('admitted');
    expect(limited).toMatchObject({ kind: 'license_invalid', because: 'free_month_used' });
    expect((await metered.state()).admitted.licensed).toBe(1);
  });

  it('goes back to its license once Auto answers its report with credits again', async () => {
    const { metered } = await licensedOn(ledgerOf, {}, (account) => {
      account.policy({ per_day: 0, per_month: 0 });
      account.fund('acme', { available: 0 });
    });
    const limited = await metered.admitted(runOf('run-1'));
    metered.account.fund('acme', { available: 10 });
    await metered.reported();

    expect(limited.kind).toBe('credits_exhausted');
    expect(await startedOnceAdmitted(metered, 'run-1')).toBe('admitted');
  });
}

function keyChangeBehaviour(ledgerOf: LedgerOf): void {
  it('falls back to the free rate, never stopping, once a report says its key was rotated, until a new key is activated', async () => {
    const { metered, key } = await licensedOn(ledgerOf);
    metered.account.revoke(key, 'key_rotated');
    await metered.reported();
    const fallen = await startedOnceAdmitted(metered, 'run-1');
    await metered.reported();
    const rotated = metered.account.keyFor(installation);

    expect(fallen).toBe('admitted');
    expect((await metered.state()).admitted).toMatchObject({ licensed: 0, actions: 1 });
    expect((await metered.state()).refused).toMatchObject({ because: 'key_rotated' });
    expect(metered.account.reportsSent()).toBe(2);
    expect(await metered.activated(rotated)).toEqual({ kind: 'activated', detail: '' });
    expect(await startedOnceAdmitted(metered, 'run-2')).toBe('admitted');
    expect((await metered.state()).admitted.licensed).toBe(1);
  });

  it('falls back to the free rate once a report says its org was closed, and keeps no stop for it', async () => {
    const { metered } = await licensedOn(ledgerOf);
    metered.account.close({ detail: 'The org acme was deleted for good', because: 'org_purged' });
    await metered.reported();

    expect(await startedOnceAdmitted(metered, 'run-1')).toBe('admitted');
    expect((await metered.state()).refused).toMatchObject({ because: 'org_purged' });
  });

  it('refuses a key that is for another runtime without asking, linking where this one is registered', async () => {
    const { metered } = await opened(ledgerOf);
    await metered.admitted(runOf('run-1'));
    const { installation: identified = '' } = await metered.state();
    const refused = await metered.activated(metered.account.keyFor(installation));

    expect(refused.kind).toBe('license_invalid');
    expect(refused.detail).toContain(`its key is for the runtime ${installation}, and this runtime is ${identified}`);
    expect(refused.detail).toContain(`https://studio.on.auto/licenses?installation=${identified}`);
    expect(metered.account.activations()).toEqual([]);
  });
}

function orgNameBehaviour(ledgerOf: LedgerOf): void {
  it('keeps the name of its org that Auto signed into its license, on one line, and takes it again at each report', async () => {
    const { metered } = await opened(ledgerOf);
    metered.account.orgNamed('globex', `Globex\n\u001B[31mCorporation‮ ${'x'.repeat(100)}`);
    await metered.activated(metered.account.keyFor(installation, 'globex'));
    const named = (await metered.state()).license?.org_name;
    metered.account.orgNamed('globex', ' \n\t​ ');
    await metered.reported();

    expect(named).toBe(`Globex [31mCorporation ${'x'.repeat(57)}`);
    expect((await metered.state()).license?.org_name).toBeNull();
  });

  it('takes a license that carries more than it knows, as a later account service may sign', async () => {
    const { metered } = await opened(ledgerOf);
    metered.account.answer('with more than it knows');

    expect(await metered.activated(metered.account.keyFor(installation))).toEqual({ kind: 'activated', detail: '' });
  });
}

const notAuto: readonly (readonly [string, Answering, string])[] = [
  ['signed by another key under the kid of Auto’s', 'by another key', 'not one Auto signed'],
  ['signed by a key Auto does not hold', 'by an unknown key', 'not one Auto signed'],
  ['tampered with after it was signed', 'tampered', 'not one Auto signed'],
  ['of an earlier version, as the entitlement was', 'of another version', 'not one Auto signed'],
  ['for another runtime', 'for another installation', 'its license is for the runtime another-installation'],
];

function invalidLicenseBehaviour(ledgerOf: LedgerOf): void {
  it.each(notAuto)('refuses a license %s as license_invalid, and records none', async (_, how, why) => {
    const { metered } = await opened(ledgerOf);
    metered.account.answer(how);
    const refused = await metered.activated(metered.account.keyFor(installation));

    expect(refused.kind).toBe('license_invalid');
    expect(refused.detail).toContain(why);
    expect((await metered.state()).license).toBeUndefined();
  });

  it('keeps its last license when a report is answered with one Auto did not sign, and says why', async () => {
    const { metered } = await licensedOn(ledgerOf);
    metered.account.fund('acme', { available: 0 });
    metered.account.answer('tampered');

    expect(await metered.reported()).toMatchObject({ kind: 'meter_unavailable' });
    expect((await metered.state()).license).toMatchObject({ admits_through: 1000, standing: 'ok' });
  });
}

export function licensesBehaviour(ledgerOf: LedgerOf): void {
  activationBehaviour(ledgerOf);
  keptLicenseBehaviour(ledgerOf);
  licensedAdmissionBehaviour(ledgerOf);
  timeBehaviour(ledgerOf);
  keyChangeBehaviour(ledgerOf);
  orgNameBehaviour(ledgerOf);
  invalidLicenseBehaviour(ledgerOf);
  fallbackWordsBehaviour(ledgerOf);
  closedAccountBehaviour(ledgerOf);
  keptWordingBehaviour(ledgerOf);
}
