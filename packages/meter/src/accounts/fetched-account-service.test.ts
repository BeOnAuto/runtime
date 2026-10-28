import { Effect, Function, Option } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { actionDigestOf } from '../admission/action-digest.ts';
import { allocationIn } from '../licensing/signed-answers.ts';
import { accountFake } from '../testing/account-fake.ts';
import { accountServerOver } from '../testing/account-server.ts';
import { runOf } from '../testing/runs.ts';
import { testSigners } from '../testing/test-signing.ts';
import { accountServiceAt } from './fetched-account-service.ts';

const installation = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7e';

const usage = { actions: 2, last: 'event-7' };

const counted = { ...usage, through: ['7'] };

const run1 = actionDigestOf(runOf('run-1'));

const run2 = actionDigestOf(runOf('run-2'));

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
    const activation = await outcomeOf(account.activate(key, { installation, ...counted }));

    expect(activation).toMatchObject({ entitlement: { kid: 'test-2026-10' }, repair: null });
    expect(fake.activations()).toEqual([{ installation, ...usage }]);
  });

  it('asks it to admit a run and answers its signed admission, and reports a count, which it takes', async () => {
    const { fake, account, key } = await served();
    const admission = await outcomeOf(account.admit(key, run1));
    const reported = await outcomeOf(account.report(key, counted));

    expect([admission, reported]).toMatchObject([{ kid: 'test-2026-10' }, undefined]);
    expect(fake.charged()).toEqual([`installation:${installation}/${run1}`]);
    expect(fake.reports()).toEqual([usage]);
  });
});

describe('what the account service is sent over HTTP', () => {
  it('sends each call the fields it names and no other, leaving out the point of the ledger its count reached', async () => {
    const { fake, server, account, key } = await served();
    const signed = fake.allocationFor(installation, 5);
    const { id } = Option.getOrThrow(allocationIn(signed, testSigners));
    const report = { allocation: id, installation, sequence: 1, spent: 2, at: '2026-10-27T12:00:00.000Z' };
    await outcomeOf(account.activate(key, { installation, ...counted }));
    await outcomeOf(account.admit(key, run1));
    await outcomeOf(account.report(key, counted));
    await outcomeOf(account.refreshAllocation(key, id));
    await outcomeOf(account.reportAllocation(key, { report, signature: 'its-signature' }));

    expect(server.received()).toEqual([
      { path: '/v1/installations/activate', authorization: `Bearer ${key}`, body: { installation, ...usage } },
      { path: '/v1/installations/actions', authorization: `Bearer ${key}`, body: { action: run1 } },
      { path: '/v1/installations/reports', authorization: `Bearer ${key}`, body: usage },
      { path: '/v1/installations/allocations/refresh', authorization: `Bearer ${key}`, body: { allocation: id } },
      {
        path: '/v1/installations/allocations/report',
        authorization: `Bearer ${key}`,
        body: { report, signature: 'its-signature' },
      },
    ]);
  });
});

describe('what the account service is sent over HTTP, whatever it is handed', () => {
  it('leaves out whatever else the value handed to a call holds', async () => {
    const { server, account, key } = await served();
    const widenedUsage = { ...counted, prompt: 'Summarize the payroll of Ada Lovelace', started_by: 'person:ada' };
    const widenedActivation = { installation, ...widenedUsage, input: { iban: 'GB33BUKB20201555555555' } };
    const report = { allocation: 'allocation-1', installation, sequence: 1, spent: 2, at: '2026-10-27T12:00:00Z' };
    const widenedReport = { report: { ...report, definition_name: 'payroll' }, signature: 's', output: 'paid' };
    await outcomeOf(account.activate(key, widenedActivation));
    await outcomeOf(account.report(key, widenedUsage));
    await outcomeOf(account.reportAllocation(key, widenedReport));

    expect(server.received().map(({ body }) => body)).toEqual([
      { installation, ...usage },
      usage,
      { report, signature: 's' },
    ]);
  });

  it('sends no admission whose action is anything but the SHA-256 of where the run ran, and asks nothing', async () => {
    const { server, account, key } = await served();
    const named = await outcomeOf(account.admit(key, 'acme/alpha/run-1'));

    expect(named).toMatchObject({
      _tag: 'account_failure',
      status: 0,
      kind: 'unreachable',
      detail: 'The runtime sends the account service only the fields its call names',
    });
    expect(server.received()).toEqual([]);
  });
});

describe('the refusals of the account service over HTTP', () => {
  it('answers the refusal of the account with its status, kind and words', async () => {
    const { fake, account, key } = await served();
    fake.exhaust();

    expect(await outcomeOf(account.admit(key, run1))).toMatchObject({
      _tag: 'account_failure',
      status: 409,
      kind: 'credits_exhausted',
      detail: 'The org acme has no credits left',
    });
  });

  it('answers the case of the refusal and where a person resolves it, where the account gives them', async () => {
    const { fake, account, key } = await served();
    fake.exhaust({ because: 'free_month_used', resolve_at: 'https://studio.on.auto/billing?org=acme' });
    const exhausted = await outcomeOf(account.admit(key, run1));
    fake.revoke(key, 'key_rotated');

    expect(exhausted).toMatchObject({
      kind: 'credits_exhausted',
      because: 'free_month_used',
      resolve_at: 'https://studio.on.auto/billing?org=acme',
    });
    expect(await outcomeOf(account.admit(key, run2))).toMatchObject({
      status: 403,
      kind: 'license_invalid',
      detail: 'The key was rotated',
      because: 'key_rotated',
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
