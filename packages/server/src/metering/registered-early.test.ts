import { describe, expect, it, onTestFinished } from 'vitest';

import { accountsServed, runtimeIdOf, servedBy } from '../testing/accounts/licensed-server.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { tallied, talliedTimes } from '../testing/servers/tally-server.ts';

describe('a runtime registered after 10 of its 100 free runs', () => {
  it('asks the org’s account for every run once its key is in hand, so the 90 it did not use are not spent while it holds the key', async () => {
    const accounts = await accountsServed();
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const unregistered = await servedBy(accounts, {}, { ledger });
    await talliedTimes(unregistered, 10);
    const key = accounts.account.keyFor(await runtimeIdOf(unregistered));
    await unregistered.stop();

    const licensed = await servedBy(accounts, { AUTO_RUNTIME_LICENSE_KEY: key }, { ledger });
    const charged = await tallied(licensed);
    accounts.account.exhaust();
    const refused = await tallied(licensed);
    const whileLicensed = await licensed.call('GET', '/v1/orgs/acme/license');
    await licensed.stop();

    expect(charged.status).toBe(200);
    expect(accounts.account.charged()).toHaveLength(1);
    expect(refused).toMatchObject({ status: 409, body: { kind: 'credits_exhausted' } });
    expect(whileLicensed.body).toMatchObject({ state: 'licensed', free_runs: { used: 11, of: 100 } });
  }, 60_000);

  it('runs what is left of the 100 again, without asking Auto, once it starts without its key', async () => {
    const accounts = await accountsServed();
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const unregistered = await servedBy(accounts, {}, { ledger });
    await talliedTimes(unregistered, 10);
    const key = accounts.account.keyFor(await runtimeIdOf(unregistered));
    await unregistered.stop();
    const licensed = await servedBy(accounts, { AUTO_RUNTIME_LICENSE_KEY: key }, { ledger });
    await tallied(licensed);
    await licensed.stop();
    const askedWhileLicensed = accounts.account.askedToAdmit();

    const keyless = await servedBy(accounts, {}, { ledger });
    const admitted = await talliedTimes(keyless, 89);
    const refused = await tallied(keyless);

    expect(admitted.every(({ status }) => status === 200)).toBe(true);
    expect(refused).toMatchObject({ status: 409, body: { kind: 'license_required' } });
    expect(accounts.account.askedToAdmit()).toBe(askedWhileLicensed);
    expect((await keyless.call('GET', '/v1/orgs/acme/license')).body).toMatchObject({
      state: 'unregistered',
      free_runs: { used: 100, of: 100 },
    });
  }, 60_000);
});
