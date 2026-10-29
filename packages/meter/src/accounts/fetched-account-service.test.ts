import { Effect, Function, Option, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { allocationIn, licenseIn, SignedSchema } from '../licensing/signed-answers.ts';
import { accountFake } from '../testing/account-fake.ts';
import { accountServerOver } from '../testing/account-server.ts';
import { testSigners } from '../testing/test-signing.ts';
import { accountServiceAt, type AccountsAt } from './fetched-account-service.ts';

const installation = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7e';

const usage = { actions: 3, licensed: 2 };

interface Sent {
  readonly address: string;
  readonly authorization: string | undefined;
  readonly body: string;
}

async function served() {
  const fake = accountFake();
  const server = await accountServerOver(fake);
  onTestFinished(() => server.close());
  const sent: Sent[] = [];
  const recording: AccountsAt['fetch'] = (address, request) => {
    sent.push({ address, authorization: request.headers['authorization'], body: request.body });
    return fetch(address, request);
  };
  const account = accountServiceAt({ origin: server.origin, fetch: recording });
  return { fake, server, account, key: fake.keyFor(installation), sent: () => [...sent] };
}

function outcomeOf<A, E>(work: Effect.Effect<A, E>): Promise<A | E> {
  return Effect.runPromise(work.pipe(Effect.match({ onFailure: Function.identity, onSuccess: Function.identity })));
}

const signedIn = Schema.decodeUnknownOption(SignedSchema);

function licenseOf(answer: unknown) {
  return Option.getOrUndefined(Option.flatMap(signedIn(answer), (signed) => licenseIn(signed, testSigners)));
}

describe('the account service over HTTP', () => {
  it('activates with the key as a bearer, the runtime, its runs and its licensed runs, and answers the signed license', async () => {
    const { fake, account, key, server, sent } = await served();
    const activation = await outcomeOf(account.activate(key, { installation, ...usage }));

    expect(sent()).toEqual([
      {
        address: `${server.origin}/v1/installations/activate`,
        authorization: `Bearer ${key}`,
        body: JSON.stringify({ installation, actions: 3, licensed: 2 }),
      },
    ]);
    expect(activation).toMatchObject({ kid: 'test-2026-10' });
    expect(licenseOf(activation)).toMatchObject({ v: 2, kind: 'license', installation, charged_through: 2 });
    expect(fake.activations()).toEqual([{ installation, ...usage }]);
  });

  it('reports its runs and its licensed runs, and answers the license Auto signed for the report', async () => {
    const { fake, account, key, server, sent } = await served();
    const reported = await outcomeOf(account.report(key, usage));

    expect(sent()).toEqual([
      {
        address: `${server.origin}/v1/installations/reports`,
        authorization: `Bearer ${key}`,
        body: JSON.stringify({ actions: 3, licensed: 2 }),
      },
    ]);
    expect(licenseOf(reported)).toMatchObject({ charged_through: 2, admits_through: 1000 });
    expect(fake.reports()).toEqual([usage]);
  });
});

describe('the refusals of the account service over HTTP', () => {
  it('answers the refusal of a key with its status, kind, words and case', async () => {
    const { fake, account, key } = await served();
    fake.revoke(key, 'key_rotated');

    expect(await outcomeOf(account.report(key, usage))).toMatchObject({
      _tag: 'account_failure',
      status: 403,
      kind: 'license_invalid',
      detail: 'The key was rotated',
      because: 'key_rotated',
    });
  });

  it('answers a closed account with its status, case and where a person resolves it', async () => {
    const { fake, account, key } = await served();
    fake.close({
      detail: 'The org acme was deleted',
      because: 'org_deleted',
      resolve_at: 'https://studio.on.auto/support',
    });

    expect(await outcomeOf(account.activate(key, { installation, ...usage }))).toMatchObject({
      status: 410,
      kind: 'account_closed',
      because: 'org_deleted',
      resolve_at: 'https://studio.on.auto/support',
    });
  });

  it('answers a refusal without words with its status alone, as per-run admission now is', async () => {
    const { server, key } = await served();
    const elsewhere = accountServiceAt({ origin: `${server.origin}/elsewhere`, fetch });
    const admission = await fetch(`${server.origin}/v1/installations/actions`, { method: 'POST', body: '{}' });

    expect(await outcomeOf(elsewhere.report(key, usage))).toMatchObject({
      _tag: 'account_failure',
      status: 404,
      kind: 'unknown',
      detail: 'The account service answered 404',
    });
    expect(admission.status).toBe(404);
  });
});

describe('the account service over HTTP that does not answer', () => {
  it('is unreachable when no answer comes, or one in a shape the runtime does not know', async () => {
    const { fake, server, account, key } = await served();
    fake.goDown();
    const dropped = await outcomeOf(account.report(key, usage));
    fake.comeBack();
    server.garble();

    expect(dropped).toMatchObject({ _tag: 'account_failure', status: 0, kind: 'unreachable' });
    expect(String(Reflect.get(new Object(dropped), 'detail'))).toContain(`The account service at ${server.origin}`);
    expect(await outcomeOf(account.report(key, usage))).toMatchObject({
      kind: 'unreachable',
      detail: 'The account service answered in a shape the runtime does not know',
    });
  });

  it.each(['activate', 'reports', 'allocations/refresh', 'allocations/report'])(
    'refuses a body it cannot read at %s as invalid input',
    async (path) => {
      const { server } = await served();
      const answer = await fetch(`${server.origin}/v1/installations/${path}`, { method: 'POST', body: '{' });

      expect([answer.status, await answer.json()]).toEqual([
        400,
        { kind: 'invalid_input', detail: 'The body could not be read' },
      ]);
    },
  );

  it('listens on the port it is given, as a stand-in for billing.on.auto beside a runtime', async () => {
    const free = await accountServerOver(accountFake());
    const port = Number(new URL(free.origin).port);
    await free.close();
    const pinned = await accountServerOver(accountFake(), port);
    onTestFinished(() => pinned.close());

    expect(pinned.origin).toBe(`http://127.0.0.1:${port}`);
  });
});

describe('the allocation calls over HTTP', () => {
  it('refreshes an allocation, answering it signed again, and reports on it, answering whether Auto took it', async () => {
    const { fake, account, key } = await served();
    const signed = fake.allocationFor(installation, 5);
    const { id } = Option.getOrThrow(allocationIn(signed, testSigners));
    const refreshed = await outcomeOf(account.refreshAllocation(key, id));
    const report = { allocation: id, installation, sequence: 1, spent: 2, at: '2026-10-27T12:00:00.000Z' };
    const unsigned = await outcomeOf(account.reportAllocation(key, { report, signature: 'not-its-signature' }));
    const unknown = await outcomeOf(account.refreshAllocation(key, 'another'));

    expect(refreshed).toMatchObject({ kid: 'test-2026-10' });
    expect(unsigned).toBe('The report is not signed by its installation');
    expect(unknown).toMatchObject({ status: 403, kind: 'license_invalid', detail: 'The key holds no such allocation' });
  });
});
