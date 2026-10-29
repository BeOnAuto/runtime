import { expect, it } from 'vitest';

import { METER_STREAM } from '../meter-stream/meter-events.ts';
import type { Metered } from '../testing/metered.ts';
import { licensedInstallation, licensedOn, opened, restartedOf, type LedgerOf } from './opened.ts';

const feature = 'prediction-example';

const listed = [feature, 'prediction-other'];

const granted = (account: Metered['account']) => {
  account.grant('acme', listed);
};

const use = { org: 'acme', feature, which: 'executes example models' };

interface Seen {
  readonly state: string;
  readonly included: boolean;
  readonly features: readonly string[];
}

async function seenOn(metered: Metered): Promise<Seen> {
  const { state, features } = await metered.status();
  return { state, included: await metered.includes(feature), features };
}

const inForce = (state: string): Seen => ({ state, included: true, features: listed });

const none = (state: string): Seen => ({ state, included: false, features: [] });

function withoutBehaviour(ledgerOf: LedgerOf): void {
  it('include none without a key, and none on a license that lists none', async () => {
    const { metered } = await opened(ledgerOf);
    const { metered: unlisted } = await licensedOn(ledgerOf);

    expect([await seenOn(metered), await seenOn(unlisted)]).toEqual([none('unregistered'), none('licensed')]);
  });

  it('include none for a key not activated yet', async () => {
    const { metered } = await opened(ledgerOf);
    granted(metered.account);
    const keyed = await restartedOf(metered, { key: metered.account.keyFor(licensedInstallation) });

    expect(await seenOn(keyed)).toEqual(none('limited'));
  });
}

function inForceBehaviour(ledgerOf: LedgerOf): void {
  it('include those the license of the key in force lists, licensed and out of touch until its limit', async () => {
    const { metered } = await licensedOn(ledgerOf, {}, granted);
    const licensed = await seenOn(metered);
    metered.at('2026-11-11T12:00:00.000Z');

    expect([licensed, await seenOn(metered), await metered.includes('prediction-unlisted')]).toEqual([
      inForce('licensed'),
      inForce('out_of_touch'),
      false,
    ]);
  });

  it.each([
    ['out of credits', { available: 0 }, 'credits'],
    ['at its overage cap', { plan: 'team', available: 0, owed: 600, overage_cap: 600 }, 'cap'],
  ] as const)('stand while its org is %s, its runs limited to the free rate', async (_case, books, because) => {
    const { metered } = await licensedOn(ledgerOf, {}, (account) => {
      granted(account);
      account.fund('acme', books);
    });

    expect([await seenOn(metered), (await metered.status()).limited_because]).toEqual([inForce('limited'), because]);
  });

  it('follow the license a renewal brings, adding a feature and taking one away', async () => {
    const { metered } = await licensedOn(ledgerOf, {}, granted);
    metered.account.grant('acme', ['prediction-other']);
    await metered.reported();
    const removed = await seenOn(metered);
    metered.account.grant('acme', [...listed, 'prediction-third']);
    await metered.reported();

    expect([removed.included, removed.features, (await metered.status()).features]).toEqual([
      false,
      ['prediction-other'],
      [...listed, 'prediction-third'],
    ]);
  });
}

function lapsedBehaviour(ledgerOf: LedgerOf): void {
  it('include none once the license lapsed at its limit', async () => {
    const { metered } = await licensedOn(ledgerOf, {}, granted);
    metered.at('2026-11-24T12:00:00.000Z');

    expect(await seenOn(metered)).toEqual(none('limited'));
  });

  it.each(['key_rotated', 'installation_revoked'] as const)(
    'include none once a report says %s',
    async (revocation) => {
      const { metered, key } = await licensedOn(ledgerOf, {}, granted);
      metered.account.revoke(key, revocation);
      await metered.reported();

      expect(await seenOn(metered)).toEqual(none('limited'));
    },
  );

  it('include none once a report says its org was closed', async () => {
    const { metered } = await licensedOn(ledgerOf, {}, granted);
    metered.account.close({ detail: 'The org acme was deleted; an owner can restore it', because: 'org_deleted' });
    await metered.reported();

    expect(await seenOn(metered)).toEqual(none('limited'));
  });
}

function offlineBehaviour(ledgerOf: LedgerOf): void {
  it('stand while live offline credits admit its runs, past the license’s limit, and none once those credits stopped', async () => {
    const { metered } = await licensedOn(ledgerOf, {}, granted);
    await metered.allocated(metered.account.allocationFor(licensedInstallation, 5));
    const offline = await seenOn(metered);
    metered.at('2026-11-25T12:00:00.000Z');
    const pastTheLimit = await seenOn(metered);
    metered.at('2026-11-27T12:00:00.000Z');

    expect([offline, pastTheLimit, await seenOn(metered)]).toEqual([
      inForce('offline'),
      inForce('offline'),
      none('invalid'),
    ]);
  });
}

function refusalBehaviour(ledgerOf: LedgerOf): void {
  it('refuses work that needs a feature in the words of a license, naming the feature, its work and where to add it', async () => {
    const { metered } = await licensedOn(ledgerOf);
    const page = `https://studio.on.auto/licenses?installation=${licensedInstallation}`;

    expect(await metered.featureRefusal(use)).toEqual({
      kind: 'feature_unlicensed',
      detail: `This runtime's license does not include ${feature}, which executes example models. The account holder or an organization admin can add it at ${page}.`,
      resolve_at: page,
      runtime_id: licensedInstallation,
    });
  });

  it('refuses a runtime nobody identified yet at the licenses page itself', async () => {
    const { metered } = await opened(ledgerOf);

    expect((await metered.featureRefusal(use)).resolve_at).toBe('https://studio.on.auto/licenses');
  });

  it('answers meter_unavailable when it cannot read its ledger, as its status does', async () => {
    const { metered, tampering } = await licensedOn(ledgerOf, {}, granted);
    const [first = ''] = await tampering.idsOf(METER_STREAM);
    await tampering.garbled(first);

    expect([(await metered.refusedIncludes(feature)).kind, (await metered.featureRefusal(use)).kind]).toEqual([
      'meter_unavailable',
      'meter_unavailable',
    ]);
  });
}

export function featuresBehaviour(ledgerOf: LedgerOf): void {
  withoutBehaviour(ledgerOf);
  inForceBehaviour(ledgerOf);
  lapsedBehaviour(ledgerOf);
  offlineBehaviour(ledgerOf);
  refusalBehaviour(ledgerOf);
}
