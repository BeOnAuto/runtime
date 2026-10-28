import { expect, it } from 'vitest';

import type { Revocation } from '../testing/account-fake.ts';
import { runOf } from '../testing/runs.ts';
import { allocatedOn, licensedInstallation, licensedOn, opened, restartedOf, type LedgerOf } from './opened.ts';

const installation = licensedInstallation;

const page = `https://studio.on.auto/licenses?installation=${installation}`;

const rotatedWords = `This runtime's key was replaced. Activate the new key an owner was shown when they rotated it, then run this again. If the key is lost, an owner can rotate it again at ${page}.`;

const removedWords = `This runtime was removed from its org. To use it again, an owner can register it again at ${page}, then activate the new key and run this again.`;

const revocations: readonly (readonly [string, Revocation, string])[] = [
  ['its key was rotated', 'key_rotated', rotatedWords],
  ['its installation was removed from its org', 'installation_revoked', removedWords],
];

export function revocationCaseBehaviour(ledgerOf: LedgerOf): void {
  it.each(revocations)(
    'refuses a run in the words of the case when the account says %s, and every run after it',
    async (_, because, detail) => {
      const { metered, key } = await licensedOn(ledgerOf);
      await metered.admitted(runOf('run-1'));
      metered.account.revoke(key, because);
      const refused = await metered.admitted(runOf('run-2'));
      const restarted = await restartedOf(metered);

      expect(refused).toEqual({ kind: 'license_invalid', detail, because, resolve_at: page, runtime_id: installation });
      expect(await restarted.admitted(runOf('run-3'))).toEqual(refused);
      expect((await restarted.state()).license?.invalid).toMatchObject({ because });
    },
  );

  it.each(revocations)('refuses to activate a key in the words of the case when %s', async (_, because, detail) => {
    const { metered } = await opened(ledgerOf);
    const key = metered.account.keyFor(installation);
    metered.account.revoke(key, because);

    expect(await metered.activated(key)).toEqual({
      kind: 'license_invalid',
      detail,
      because,
      resolve_at: page,
      runtime_id: installation,
    });
  });
}

export function creditCaseBehaviour(ledgerOf: LedgerOf): void {
  it.each(['none_left', 'free_daily_limit', 'free_month_used'])(
    'refuses as credits_exhausted with the case %s the account names, and where it says the org gets more',
    async (because) => {
      const { metered } = await licensedOn(ledgerOf);
      metered.account.exhaust({ because, resolve_at: 'https://studio.on.auto/billing?org=acme' });

      expect(await metered.admitted(runOf('run-1'))).toEqual({
        kind: 'credits_exhausted',
        detail: 'The org acme has no credits left',
        because,
        resolve_at: 'https://studio.on.auto/billing?org=acme',
      });
    },
  );

  it('leaves out a case of credits it does not know, and a place to resolve them that is no URL', async () => {
    const { metered } = await licensedOn(ledgerOf);
    metered.account.exhaust({ because: 'over_the_moon', resolve_at: 'the billing page' });

    expect(await metered.admitted(runOf('run-1'))).toEqual({
      kind: 'credits_exhausted',
      detail: 'The org acme has no credits left',
    });
  });
}

export const closedAccounts = [
  [
    'deleted, which can still be restored',
    {
      because: 'org_deleted',
      detail: 'The org acme was deleted; an owner can restore it',
      resolve_at: 'https://studio.example.com/orgs/acme',
    },
  ],
  ['purged, which never runs again', { because: 'org_purged', detail: 'The org acme was deleted for good' }],
] as const;

const aWeekAndADayLater = '2026-11-04T12:00:00.000Z';

export function closedAccountBehaviour(ledgerOf: LedgerOf): void {
  it.each(closedAccounts)(
    'refuses a run as account_closed when the account says the org was %s, in its words and with its reason',
    async (_, closed) => {
      const { metered } = await licensedOn(ledgerOf);
      await metered.admitted(runOf('run-1'));
      metered.account.close(closed);

      expect(await metered.admitted(runOf('run-2'))).toEqual({ kind: 'account_closed', ...closed });
    },
  );

  it.each(closedAccounts)(
    'refuses to activate a key as account_closed when the org was %s, never as unavailable or as an invalid license',
    async (_, closed) => {
      const { metered } = await opened(ledgerOf);
      const key = metered.account.keyFor(installation);
      metered.account.close(closed);

      expect(await metered.activated(key)).toEqual({ kind: 'account_closed', ...closed });
    },
  );

  it('refuses a run as account_closed when the entitlement it renews is of a closed org, never as a license not renewed', async () => {
    const [[, deleted]] = closedAccounts;
    const { metered } = await licensedOn(ledgerOf);
    await metered.admitted(runOf('run-1'));
    metered.at(aWeekAndADayLater);
    metered.account.at(aWeekAndADayLater);
    metered.account.close(deleted);

    expect(await metered.admitted(runOf('run-2'))).toEqual({ kind: 'account_closed', ...deleted });
  });

  it('leaves out a reason for closing that is neither of the two, and a place to restore the org that is no URL', async () => {
    const { metered } = await licensedOn(ledgerOf);
    metered.account.close({ detail: 'The org acme is closed', because: 'org_suspended', resolve_at: 'the org page' });

    expect(await metered.admitted(runOf('run-1'))).toEqual({
      kind: 'account_closed',
      detail: 'The org acme is closed',
    });
  });
}

const accountsPage = `https://studio.example.com/licenses?installation=${installation}`;

function termsWords(at: string): string {
  return `Auto needs an owner of this runtime's org to accept its activation terms for self-hosted runtimes before this runtime's key activates or renews. An owner reads and accepts them at ${at}; then run this again.`;
}

function termsRequiredAt(at: string) {
  return { kind: 'terms_required', detail: termsWords(at), resolve_at: at, runtime_id: installation };
}

const unlinkedTerms: readonly (readonly [string, Readonly<{ resolve_at?: string }>])[] = [
  ['gives no page', {}],
  ['gives a page that is no URL', { resolve_at: 'the licenses page' }],
];

function termsActivationBehaviour(ledgerOf: LedgerOf): void {
  it('refuses to activate a key as terms_required at the page the account gives, never as unavailable, and activates it once an owner accepted', async () => {
    const { metered } = await opened(ledgerOf);
    const key = metered.account.keyFor(installation);
    metered.account.requireTerms({ resolve_at: accountsPage });
    const refused = await metered.activated(key);
    const { license } = await metered.state();
    metered.account.acceptTerms();

    expect(refused).toEqual(termsRequiredAt(accountsPage));
    expect(license).toBeUndefined();
    expect(await metered.activated(key)).toEqual({ kind: 'activated', detail: '' });
  });

  it.each(unlinkedTerms)(
    'refuses as terms_required at its own page of the installation in Studio when the account %s',
    async (_, refusal) => {
      const { metered } = await opened(ledgerOf);
      const key = metered.account.keyFor(installation);
      metered.account.requireTerms(refusal);

      expect(await metered.activated(key)).toEqual(termsRequiredAt(page));
    },
  );

  it('refuses each run as terms_required with the key it was given, keeps the key across a restart, and admits once an owner accepted', async () => {
    const { metered } = await opened(ledgerOf);
    metered.account.requireTerms({ resolve_at: accountsPage });
    const given = await restartedOf(metered, { key: metered.account.keyFor(installation) });
    const refused = await given.admitted(runOf('run-1'));
    const restarted = await restartedOf(given);
    const again = await restarted.admitted(runOf('run-1'));
    const { license } = await restarted.state();
    metered.account.acceptTerms();

    expect([refused, again]).toEqual([termsRequiredAt(accountsPage), termsRequiredAt(accountsPage)]);
    expect(license).toBeUndefined();
    expect((await restarted.admitted(runOf('run-1'))).kind).toBe('admitted');
    expect(metered.account.charged()).toEqual([`installation:${installation}/acme/alpha/run-1`]);
  });
}

function termsRenewalBehaviour(ledgerOf: LedgerOf): void {
  it('refuses a run as terms_required when the expired entitlement it renews waits on the terms, never as a license not renewed, and renews once an owner accepted', async () => {
    const { metered } = await licensedOn(ledgerOf);
    await metered.admitted(runOf('run-1'));
    metered.at(aWeekAndADayLater);
    metered.account.at(aWeekAndADayLater);
    metered.account.requireTerms();
    const refused = await metered.admitted(runOf('run-2'));
    const { license } = await metered.state();
    metered.account.acceptTerms();

    expect(refused).toEqual(termsRequiredAt(page));
    expect(license?.invalid).toBeUndefined();
    expect((await metered.admitted(runOf('run-2'))).kind).toBe('admitted');
    expect((await metered.state()).license?.expires_at).toBe('2026-11-11T12:00:00.000Z');
  });

  it('keeps admitting by a live entitlement while its daily refresh is refused as terms_required, saying why in its words', async () => {
    const { metered } = await licensedOn(ledgerOf);
    await metered.admitted(runOf('run-1'));
    metered.account.requireTerms();

    expect(await metered.refreshed()).toEqual({ kind: 'refreshed', detail: '' });
    expect(metered.warnings().at(-1)).toBe(`The license of this runtime could not be refreshed: ${termsWords(page)}`);
    expect((await metered.admitted(runOf('run-2'))).kind).toBe('admitted');
    const { license } = await metered.state();
    expect([license?.invalid, license?.expires_at]).toEqual([undefined, '2026-11-03T12:00:00.000Z']);
  });

  it('keeps its allocation while its refresh is refused as terms_required, saying why in its words, and admits by it', async () => {
    const { metered } = await allocatedOn(ledgerOf, 5);
    metered.account.requireTerms();
    await metered.refreshed();
    const { allocation } = await metered.state();
    const allocated = String(allocation?.installation);
    const allocatedPage = `https://studio.on.auto/licenses?installation=${allocated}`;

    expect(
      metered.warnings().filter((line) => line.startsWith('This runtime could not refresh its allocation')),
    ).toEqual([`This runtime could not refresh its allocation with Auto: ${termsWords(allocatedPage)}`]);
    expect([allocation?.withdrawn, allocation?.refresh_by]).toEqual([undefined, '2026-11-03T12:00:00.000Z']);
    expect((await metered.admitted(runOf('run-1'))).kind).toBe('admitted');
    expect(metered.account.askedToAdmit()).toBe(0);
  });
}

export function termsBehaviour(ledgerOf: LedgerOf): void {
  termsActivationBehaviour(ledgerOf);
  termsRenewalBehaviour(ledgerOf);
}

export function keptWordingBehaviour(ledgerOf: LedgerOf): void {
  it('refuses what is not a key of Studio, and a key Auto does not know, as license_invalid', async () => {
    const { metered } = await opened(ledgerOf);
    const notAKey = await metered.activated('alk_acme_secret');
    const unknown = await metered.activated(`alk.acme.${installation}.unknown`);

    expect(notAKey).toEqual({
      kind: 'license_invalid',
      detail:
        "This runtime's license does not stand: its key is not a license key of Studio, which reads alk.<org>.<installation>.<secret>. Activate a key of this installation, which an owner of its org registers at https://studio.on.auto/licenses",
      resolve_at: 'https://studio.on.auto/licenses',
    });
    expect(unknown).toEqual({
      kind: 'license_invalid',
      detail: `This runtime's license does not stand: The key is unknown, was rotated away or its installation was revoked. Activate a key of this installation, which an owner of its org registers at ${page}`,
      resolve_at: page,
      runtime_id: installation,
    });
  });
}
