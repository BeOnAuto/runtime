import { asTheCompanysServiceAccount } from '@on.auto/providers/testing';
import { describe, expect, it } from 'vitest';

import { reconnected, type Added } from '../testing/additions.ts';
import { addedThe, byItsId, exchanging, onTheLink, sameLedgerWith } from '../testing/exchange-harness.ts';
import { emailOf, exchangeProvidersWith, managedWay, ownValues, ownWay, tokenEndpoint } from '../testing/exchanges.ts';
import type { Harness } from '../testing/harness.ts';

const anyWords: unknown = expect.any(String);

describe('the service account Auto creates for a connection, by create_service_account', () => {
  it('is created once, recorded once and answered the same when asked again', async () => {
    const { h, accounts } = exchanging();
    const link = await addedThe(h, managedWay);

    const outcomes = [
      await onTheLink(h, 'create_service_account', link),
      await onTheLink(h, 'create_service_account', link),
    ];

    expect(outcomes).toMatchObject([
      { status: 'succeeded', output: { email: emailOf(link.id) } },
      { status: 'succeeded', output: { email: emailOf(link.id) } },
    ]);
    expect(accounts.created()).toEqual([{ tokenEndpoint, org: 'acme', connection: link.id }]);
    expect((await h.facts()).filter(({ type }) => type === 'connection_service_account_created')).toHaveLength(1);
    expect(await onTheLink(h, 'read_link', link)).toMatchObject({
      output: { service_account: { email: emailOf(link.id) } },
    });
  });
});

describe('the service that creates and removes a connection’s service account', () => {
  it('is asked within the context of the call, where a host finds what it bound to that call', async () => {
    const made = exchanging();
    const link = await addedThe(made.h, managedWay);
    const bound = sameLedgerWith(made, { callFetch: made.exchange.fetch });

    await onTheLink(bound, 'create_service_account', link);
    await byItsId(bound, 'remove_connection', link);

    expect(made.accounts.fetchesOfTheCalls().map((seen) => seen === made.exchange.fetch)).toEqual([true, true]);
    expect(made.accounts.removed()).toEqual([{ tokenEndpoint, org: 'acme', connection: link.id }]);
  });
});

describe('a service account Auto cannot create now', () => {
  it.each([['refused'], ['unavailable']] as const)(
    'records nothing where Auto’s service answers %s',
    async (failing) => {
      const { h, accounts } = exchanging();
      const link = await addedThe(h, managedWay);
      accounts.failWith(failing);

      const outcome = await onTheLink(h, 'create_service_account', link);

      expect(outcome).toMatchObject({ status: 'rejected', reason: 'unavailable', detail: anyWords });
      expect((await h.facts()).map(({ type }) => type)).toEqual(['connection_added', 'connection_link_issued']);
    },
  );
});

describe('a service account asked for where none is created', () => {
  it('is refused for a connection of the company’s own service account, and where none is created here', async () => {
    const own = exchanging();
    const ownLink = await addedThe(own.h, ownWay, { placeholders: ownValues });
    const managed = exchanging();
    const managedLink = await addedThe(managed.h, managedWay);
    const unprovided = sameLedgerWith(managed, {}, ['managedServiceAccounts']);

    expect([
      await onTheLink(own.h, 'create_service_account', ownLink),
      await onTheLink(unprovided, 'create_service_account', managedLink),
    ]).toMatchObject([
      { status: 'rejected', reason: 'conflict' },
      { status: 'rejected', reason: 'unavailable' },
    ]);
    expect([own.accounts.created(), managed.accounts.created()]).toEqual([[], []]);
  });
});

describe('another way chosen for a connection that acts as a service account Auto created', () => {
  it('removes the account before choosing the company’s own service account', async () => {
    const { h, accounts } = exchanging();
    const link = await addedThe(h, managedWay);
    await onTheLink(h, 'create_service_account', link);

    const chosen = await onTheLink(h, 'choose_way', link, { credential: ownWay, placeholders: ownValues });

    expect(chosen).toMatchObject({ status: 'succeeded', output: { credential: { kind: 'token_exchange' } } });
    expect(chosen).not.toHaveProperty(['output', 'service_account']);
    expect(accounts.removed()).toEqual([{ tokenEndpoint, org: 'acme', connection: link.id }]);
  });

  it('keeps the account when the same way is chosen again', async () => {
    const { h, accounts } = exchanging();
    const link = await addedThe(h, managedWay);
    await onTheLink(h, 'create_service_account', link);

    const chosen = await onTheLink(h, 'choose_way', link, { credential: managedWay });

    expect(chosen).toMatchObject({ status: 'succeeded', output: { service_account: { email: emailOf(link.id) } } });
    expect(accounts.removed()).toEqual([]);
  });
});

describe('the way of a service account Auto creates, chosen for a connection of the company’s own', () => {
  it('is recorded, and removes nothing', async () => {
    const { h, accounts } = exchanging();
    const link = await addedThe(h, ownWay, { placeholders: ownValues });

    const chosen = await onTheLink(h, 'choose_way', link, { credential: managedWay });

    expect(chosen).toMatchObject({ status: 'succeeded', output: { credential: { service_account: 'managed' } } });
    expect(accounts.removed()).toEqual([]);
  });
});

async function failingToRemove() {
  const made = exchanging();
  const link = await addedThe(made.h, managedWay);
  await onTheLink(made.h, 'create_service_account', link);
  made.accounts.failWith('unavailable');
  return { ...made, link, recorded: (await made.h.facts()).length };
}

describe('a change of a connection whose service account cannot be removed now', () => {
  it('records nothing by choose_way', async () => {
    const { h, link, recorded } = await failingToRemove();

    const outcome = await onTheLink(h, 'choose_way', link, { credential: ownWay, placeholders: ownValues });

    expect(outcome).toMatchObject({ status: 'rejected', reason: 'unavailable' });
    expect(await h.facts()).toHaveLength(recorded);
  });

  it('records nothing by remove_connection', async () => {
    const { h, link, recorded } = await failingToRemove();

    expect(await byItsId(h, 'remove_connection', link)).toMatchObject({ status: 'rejected', reason: 'unavailable' });
    expect(await h.facts()).toHaveLength(recorded);
  });
});

describe('the removal of a connection that acts as a service account Auto created', () => {
  it('removes the account first, created or not, and asks nothing to remove a removed connection', async () => {
    const { h, accounts } = exchanging();
    const created = await addedThe(h, managedWay);
    await onTheLink(h, 'create_service_account', created);
    const uncreated = await addedThe(h, managedWay, { name: 'mail-uncreated' });

    const outcomes = [
      await byItsId(h, 'remove_connection', created),
      await byItsId(h, 'remove_connection', uncreated),
      await byItsId(h, 'remove_connection', created),
    ];

    expect(outcomes).toMatchObject(outcomes.map(() => ({ status: 'succeeded', output: { status: 'removed' } })));
    expect(outcomes[0]).not.toHaveProperty(['output', 'service_account']);
    expect(accounts.removed().map(({ connection }) => connection)).toEqual([created.id, uncreated.id]);
  });

  it('removes the account at the endpoint it recorded, where the entry no longer offers its way', async () => {
    const made = exchanging();
    const link = await addedThe(made.h, managedWay);
    const later = sameLedgerWith(made, { providers: exchangeProvidersWith(asTheCompanysServiceAccount) });

    expect(await byItsId(later, 'remove_connection', link)).toMatchObject({ status: 'succeeded' });
    expect(made.accounts.removed()).toEqual([{ tokenEndpoint, org: 'acme', connection: link.id }]);
  });

  it('is refused where no service account is removed here, so the account is never left behind', async () => {
    const made = exchanging();
    const link = await addedThe(made.h, managedWay);
    const unprovided = sameLedgerWith(made, {}, ['managedServiceAccounts']);

    expect(await byItsId(unprovided, 'remove_connection', link)).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
    });
  });
});

const theAccount = { tokenEndpoint, org: 'acme' };

async function actingAsAnAccountAutoCreated() {
  const made = exchanging();
  const first = await addedThe(made.h, managedWay);
  await onTheLink(made.h, 'create_service_account', first);
  await onTheLink(made.h, 'approve', first);
  return { ...made, link: await reconnected(made.h, first.id) };
}

async function actingAsTheCompanysOwn() {
  const made = exchanging();
  const first = await addedThe(made.h, ownWay, { placeholders: ownValues });
  await onTheLink(made.h, 'approve', first);
  const link = await reconnected(made.h, first.id);
  await onTheLink(made.h, 'choose_way', link, { credential: managedWay });
  await onTheLink(made.h, 'create_service_account', link);
  return { ...made, link };
}

const errorsOf = (h: Harness) => h.logged().filter((line) => line.includes('"level":"ERROR"'));

describe('a connection that acts as a service account Auto created, reconnected another way', () => {
  it('keeps the account until the way chosen connects, then removes it', async () => {
    const { h, accounts, link } = await actingAsAnAccountAutoCreated();

    await onTheLink(h, 'choose_way', link, { credential: ownWay, placeholders: ownValues });
    const meanwhile = accounts.removed();
    const approved = await onTheLink(h, 'approve', link);

    expect(meanwhile).toEqual([]);
    expect(approved).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
    expect(approved).not.toHaveProperty(['output', 'service_account']);
    expect(accounts.removed()).toEqual([{ ...theAccount, connection: link.id }]);
  });

  it('stays connected the way chosen, and logs at the error level where its account is, when it cannot be removed then', async () => {
    const { h, accounts, link } = await actingAsAnAccountAutoCreated();
    await onTheLink(h, 'choose_way', link, { credential: ownWay, placeholders: ownValues });
    accounts.failWith('unavailable');

    const approved = await onTheLink(h, 'approve', link);
    const [line = ''] = errorsOf(h);

    expect(approved).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
    expect([accounts.removed(), errorsOf(h)]).toMatchObject([[], [anyWords]]);
    expect(line).toContain(
      `"annotations":{"org":"acme","connection":"${link.id}","token_endpoint":"${tokenEndpoint}"}`,
    );
  });

  it('is refused another account while no other way is chosen for it', async () => {
    const { h, link } = await actingAsAnAccountAutoCreated();

    expect(await onTheLink(h, 'create_service_account', link)).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
    });
  });
});

async function choosingItsOwnAgain(h: Harness, link: Added) {
  await onTheLink(h, 'choose_way', link, { credential: ownWay, placeholders: ownValues });
  await onTheLink(h, 'choose_way', link, { credential: managedWay });
  return onTheLink(h, 'create_service_account', link);
}

describe('the account Auto creates for the way chosen, where the connection acts as an account Auto created', () => {
  it('is the account it acts as, which no later choice and no connecting removes, and a removal removes once', async () => {
    const replaced = await actingAsAnAccountAutoCreated();
    const connected = await actingAsAnAccountAutoCreated();
    const removed = await actingAsAnAccountAutoCreated();
    const created = await choosingItsOwnAgain(replaced.h, replaced.link);
    await choosingItsOwnAgain(connected.h, connected.link);
    await choosingItsOwnAgain(removed.h, removed.link);

    await onTheLink(replaced.h, 'choose_way', replaced.link, { credential: ownWay, placeholders: ownValues });
    const approved = await onTheLink(connected.h, 'approve', connected.link);
    await byItsId(removed.h, 'remove_connection', removed.link);

    expect(created).toMatchObject({ status: 'succeeded' });
    expect(approved).toMatchObject({ status: 'succeeded', output: { credential: { service_account: 'managed' } } });
    expect([replaced.accounts.removed(), connected.accounts.removed(), removed.accounts.removed()]).toEqual([
      [],
      [],
      [{ ...theAccount, connection: removed.link.id }],
    ]);
  });
});

describe('the account Auto created for the way chosen, where the connection acts as the company’s own', () => {
  it('is removed when another way is chosen, or when the connection is removed', async () => {
    const replaced = await actingAsTheCompanysOwn();
    const removed = await actingAsTheCompanysOwn();

    await onTheLink(replaced.h, 'choose_way', replaced.link, { credential: ownWay, placeholders: ownValues });
    await byItsId(removed.h, 'remove_connection', removed.link);

    expect([replaced.accounts.removed(), removed.accounts.removed()]).toEqual([
      [{ ...theAccount, connection: replaced.link.id }],
      [{ ...theAccount, connection: removed.link.id }],
    ]);
  });
});
