import { Effect, Function, Option } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { allocationIn } from '../licensing/signed-answers.ts';
import { accountFake } from '../testing/account-fake.ts';
import { accountServerOver } from '../testing/account-server.ts';
import { runOf } from '../testing/runs.ts';
import { testSigners } from '../testing/test-signing.ts';
import { accountServiceAt } from './fetched-account-service.ts';

const installation = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7e';

const usage = { actions: 2, through: ['7'], last: 'event-7' };

async function served() {
  const fake = accountFake();
  const server = await accountServerOver(fake);
  onTestFinished(() => server.close());
  const account = accountServiceAt({ origin: server.origin, fetch });
  return { fake, server, account, key: fake.keyFor(installation) };
}

function outcomeOf<A, E>(work: Effect.Effect<A, E>): Promise<A | E> {
  return Effect.runPromise(work.pipe(Effect.match({ onFailure: Function.identity, onSuccess: Function.identity })));
}

describe('the account service over HTTP', () => {
  it('activates with the key as a bearer and the projected count, and answers the signed entitlement', async () => {
    const { fake, account, key } = await served();
    const activation = await outcomeOf(account.activate(key, { installation, ...usage }));

    expect(activation).toMatchObject({ entitlement: { kid: 'test-2026-10' }, repair: null });
    expect(fake.activations()).toEqual([{ installation, ...usage }]);
  });

  it('asks it to admit a run and answers its signed admission, and reports a count, which it takes', async () => {
    const { fake, account, key } = await served();
    const admission = await outcomeOf(account.admit(key, runOf('run-1')));
    const reported = await outcomeOf(account.report(key, usage));

    expect([admission, reported]).toMatchObject([{ kid: 'test-2026-10' }, undefined]);
    expect(fake.charged()).toEqual([`installation:${installation}/acme/alpha/run-1`]);
    expect(fake.reports()).toEqual([usage]);
  });
});

describe('the refusals of the account service over HTTP', () => {
  it('answers the refusal of the account with its status, kind and words', async () => {
    const { fake, account, key } = await served();
    fake.exhaust();

    expect(await outcomeOf(account.admit(key, runOf('run-1')))).toMatchObject({
      _tag: 'account_failure',
      status: 409,
      kind: 'credits_exhausted',
      detail: 'The org acme has no credits left',
    });
  });

  it('answers a refusal without words with its status alone', async () => {
    const { server, key } = await served();
    const elsewhere = accountServiceAt({ origin: `${server.origin}/elsewhere`, fetch });

    expect(await outcomeOf(elsewhere.report(key, usage))).toMatchObject({
      _tag: 'account_failure',
      status: 404,
      kind: 'unknown',
      detail: 'The account service answered 404',
    });
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

  it.each(['activate', 'actions', 'reports', 'allocations/refresh', 'allocations/report'])(
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
