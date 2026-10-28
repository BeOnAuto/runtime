import { expect, it } from 'vitest';

import type { Answering } from '../testing/account-fake.ts';
import { runOf } from '../testing/runs.ts';
import { licensedInstallation, licensedOn, opened, restartedOf, startedOnceAdmitted, type LedgerOf } from './opened.ts';
import { creditCaseBehaviour, keptWordingBehaviour, revocationCaseBehaviour } from './refusal-behaviour.ts';

const installation = licensedInstallation;

const aWeekAndADayLater = '2026-11-04T12:00:00.000Z';

const page = `https://studio.on.auto/licenses?installation=${installation}`;

function activationBehaviour(ledgerOf: LedgerOf): void {
  it('activates a key, recording the entitlement Auto signed, and admits each new action by the account from then on', async () => {
    const { metered } = await opened(ledgerOf, { allowance: 1 });
    const key = metered.account.keyFor(installation, 'globex');

    expect(await metered.activated(key)).toEqual({ kind: 'activated', detail: '' });
    expect((await metered.admitted(runOf('run-1'))).kind).toBe('admitted');
    expect((await metered.admitted(runOf('run-2'))).kind).toBe('admitted');
    expect(metered.account.charged()).toEqual([
      `installation:${installation}/acme/alpha/run-1`,
      `installation:${installation}/acme/alpha/run-2`,
    ]);
    expect(await metered.state()).toMatchObject({
      installation,
      license: {
        installation,
        org: 'globex',
        plan: 'free',
        expires_at: '2026-11-03T12:00:00.000Z',
        invalid: undefined,
      },
      holds: [],
    });
  });

  it('sends the count it projected, with the point and id of its checkpoint, as it activates', async () => {
    const { metered } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await startedOnceAdmitted(metered, 'run-2');
    const { installation: identified = '' } = await metered.state();
    await metered.activated(metered.account.keyFor(identified));
    const { checkpoint } = await metered.state();

    expect(metered.account.activations()).toEqual([
      { installation: identified, actions: 2, through: checkpoint?.through, last: checkpoint?.last },
    ]);
  });
}

function keyBehaviour(ledgerOf: LedgerOf): void {
  it('activates a key given as it starts at its first admission, and asks again for no entitlement while one stands', async () => {
    const { metered } = await licensedOn(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    const restarted = await restartedOf(metered);

    expect((await restarted.admitted(runOf('run-2'))).kind).toBe('admitted');
    expect(metered.account.activations()).toEqual([{ installation, actions: 0, through: null, last: null }]);
    expect(metered.account.askedToAdmit()).toBe(2);
  });

  it('admits by the account with a key it was handed again after a restart, as one kept in its secrets', async () => {
    const { metered, key } = await licensedOn(ledgerOf);
    await metered.admitted(runOf('run-1'));
    const restarted = await restartedOf(metered, { key: undefined, allowance: 0 });
    await restarted.held(key);

    expect((await restarted.admitted(runOf('run-2'))).kind).toBe('admitted');
    expect(metered.account.charged()).toHaveLength(2);
  });
}

function refreshBehaviour(ledgerOf: LedgerOf): void {
  it('refreshes its entitlement when asked, and refreshes nothing without a key', async () => {
    const { metered } = await licensedOn(ledgerOf);
    await metered.admitted(runOf('run-1'));
    const unlicensed = await opened(ledgerOf);

    expect([await metered.refreshed(), await unlicensed.metered.refreshed()]).toEqual([
      { kind: 'refreshed', detail: '' },
      { kind: 'refreshed', detail: '' },
    ]);
    expect(metered.account.activations()).toHaveLength(2);
    expect(unlicensed.metered.account.activations()).toEqual([]);
  });

  it('refreshes an expired entitlement as it admits, and refuses as license_invalid when it cannot', async () => {
    const { metered } = await licensedOn(ledgerOf);
    await metered.admitted(runOf('run-1'));
    metered.at(aWeekAndADayLater);
    metered.account.at(aWeekAndADayLater);
    metered.account.goDown();
    const refused = await metered.admitted(runOf('run-2'));
    metered.account.comeBack();

    expect(refused).toEqual({
      kind: 'license_invalid',
      detail:
        "This runtime's license wasn't renewed by 2026-11-03. Check that it can reach billing.on.auto (it renews every day), then run this again.",
      resolve_at: page,
      runtime_id: installation,
    });
    expect((await metered.admitted(runOf('run-2'))).kind).toBe('admitted');
    expect((await metered.state()).license?.expires_at).toBe('2026-11-11T12:00:00.000Z');
  });

  it('refuses as meter_unavailable while the account cannot be reached, or its entitlement cannot be recorded', async () => {
    const { metered } = await opened(ledgerOf);
    const key = metered.account.keyFor(installation);
    metered.account.goDown();
    const unreached = await metered.activated(key);
    metered.account.comeBack();
    metered.executesFail('conflict');

    expect([unreached.kind, (await metered.activated(key)).kind]).toEqual(['meter_unavailable', 'meter_unavailable']);
  });
}

function orgNameBehaviour(ledgerOf: LedgerOf): void {
  it('keeps the name of its org that Auto signed into its entitlement, and takes the name again as it renews', async () => {
    const { metered } = await opened(ledgerOf);
    metered.account.orgNamed('globex', 'Globex Corporation');
    await metered.activated(metered.account.keyFor(installation, 'globex'));
    const named = (await metered.state()).license?.org_name;
    metered.account.orgNamed('globex', 'Globex');
    await metered.refreshed();

    expect([named, (await metered.state()).license?.org_name]).toEqual(['Globex Corporation', 'Globex']);
  });

  it('keeps no name of its org where Auto signed none, as an account service before names', async () => {
    const { metered } = await licensedOn(ledgerOf);
    await metered.admitted(runOf('run-1'));

    expect((await metered.state()).license).toMatchObject({ org: 'acme', org_name: null });
  });

  it('takes an entitlement that carries more than it knows, as a later account service may sign', async () => {
    const { metered } = await opened(ledgerOf);
    metered.account.answer('with more than it knows');

    expect(await metered.activated(metered.account.keyFor(installation))).toEqual({ kind: 'activated', detail: '' });
    expect((await metered.admitted(runOf('run-1'))).kind).toBe('admitted');
  });
}

const notAuto: readonly (readonly [string, Answering, string])[] = [
  ['signed by another key under the kid of Auto’s', 'by another key', 'not signed by Auto'],
  ['signed by a key Auto does not hold', 'by an unknown key', 'not signed by Auto'],
  ['tampered with after it was signed', 'tampered', 'not signed by Auto'],
  ['for another installation', 'for another installation', 'for the installation another-installation'],
  ['expired', 'expired', 'expired at 2026-10-27T12:00:00.000Z'],
];

function invalidLicenseBehaviour(ledgerOf: LedgerOf): void {
  it.each(notAuto)('refuses an entitlement %s as license_invalid, and records no license', async (_, how, why) => {
    const { metered } = await opened(ledgerOf);
    metered.account.answer(how);
    const refused = await metered.activated(metered.account.keyFor(installation));

    expect(refused.kind).toBe('license_invalid');
    expect(refused.detail).toContain(why);
    expect((await metered.state()).license).toBeUndefined();
  });

  it('refuses a run as license_invalid when the key it was given at its start brings no entitlement of Auto', async () => {
    const { metered } = await opened(ledgerOf);
    metered.account.answer('by an unknown key');
    const restarted = await restartedOf(metered, { key: metered.account.keyFor(installation) });

    expect((await restarted.admitted(runOf('run-1'))).kind).toBe('license_invalid');
  });

  it('refuses a key that registers another installation without asking, linking where this one is registered', async () => {
    const { metered } = await opened(ledgerOf);
    await metered.admitted(runOf('run-1'));
    const { installation: identified = '' } = await metered.state();
    const refused = await metered.activated(metered.account.keyFor(installation));

    expect(refused.kind).toBe('license_invalid');
    expect(refused.detail).toContain(
      `registers the installation ${installation}, and this runtime is the installation`,
    );
    expect(refused.detail).toContain(`https://studio.on.auto/licenses?installation=${identified}`);
    expect(metered.account.activations()).toEqual([]);
  });
}

function revocationBehaviour(ledgerOf: LedgerOf): void {
  it('refuses new runs as license_invalid once its key is revoked, without asking again, until another key is activated', async () => {
    const { metered, key } = await licensedOn(ledgerOf);
    await metered.admitted(runOf('run-1'));
    metered.account.revoke(key);
    const refused = await metered.admitted(runOf('run-2'));
    const askedBefore = metered.account.askedToAdmit();
    const again = await metered.admitted(runOf('run-3'));
    const rotated = metered.account.keyFor(installation);

    expect([refused.kind, again.kind]).toEqual(['license_invalid', 'license_invalid']);
    expect(metered.account.askedToAdmit()).toBe(askedBefore);
    expect((await metered.state()).license?.invalid?.detail).toContain('revoked');
    expect((await metered.activated(rotated)).kind).toBe('activated');
    expect((await metered.admitted(runOf('run-3'))).kind).toBe('admitted');
  });

  it('records that its license no longer stands when the account refuses to refresh it, and says so', async () => {
    const { metered, key } = await licensedOn(ledgerOf);
    await metered.admitted(runOf('run-1'));
    metered.account.revoke(key);

    expect(await metered.refreshed()).toEqual({ kind: 'refreshed', detail: '' });
    expect((await metered.state()).license?.invalid?.detail).toContain('revoked');
    expect(metered.warnings().at(-1)).toContain('The license of this runtime could not be refreshed');
  });
}

function licensedAdmissionBehaviour(ledgerOf: LedgerOf): void {
  it('is charged once per run id however often it is asked, and a run already started is admitted without asking', async () => {
    const { metered } = await licensedOn(ledgerOf);
    await metered.admitted(runOf('run-1'));
    await metered.admitted(runOf('RUN-1'));
    await startedOnceAdmitted(metered, 'run-1');
    const askedBeforeTheStart = metered.account.askedToAdmit();
    await metered.admitted(runOf('run-1'));

    expect(metered.account.charged()).toEqual([`installation:${installation}/acme/alpha/run-1`]);
    expect([askedBeforeTheStart, metered.account.askedToAdmit()]).toEqual([3, 3]);
  });

  it('refuses as credits_exhausted in the words of the account when the org has no credit left', async () => {
    const { metered } = await licensedOn(ledgerOf);
    metered.account.exhaust();

    expect(await metered.admitted(runOf('run-1'))).toEqual({
      kind: 'credits_exhausted',
      detail: 'The org acme has no credits left',
    });
  });

  it.each<Answering>(['tampered', 'for another action', 'for another installation'])(
    'refuses as meter_unavailable an admission %s',
    async (how) => {
      const { metered } = await licensedOn(ledgerOf);
      await metered.admitted(runOf('run-1'));
      metered.account.answer(how);

      expect((await metered.admitted(runOf('run-2'))).kind).toBe('meter_unavailable');
    },
  );

  it('refuses as meter_unavailable while the account cannot be asked', async () => {
    const { metered } = await licensedOn(ledgerOf);
    await metered.admitted(runOf('run-1'));
    metered.account.goDown();

    expect((await metered.admitted(runOf('run-2'))).kind).toBe('meter_unavailable');
  });
}

export function licensesBehaviour(ledgerOf: LedgerOf): void {
  activationBehaviour(ledgerOf);
  keyBehaviour(ledgerOf);
  refreshBehaviour(ledgerOf);
  orgNameBehaviour(ledgerOf);
  invalidLicenseBehaviour(ledgerOf);
  revocationBehaviour(ledgerOf);
  revocationCaseBehaviour(ledgerOf);
  licensedAdmissionBehaviour(ledgerOf);
  creditCaseBehaviour(ledgerOf);
  keptWordingBehaviour(ledgerOf);
}
