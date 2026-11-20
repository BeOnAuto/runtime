import { makeAppRuntime } from '@on.auto/api';
import { Conflict, Ledger } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Function, Layer } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { requiredClaimSetBy } from '../sign-in/setup.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { adminGrantedBy } from './grant-admin.ts';
import { setupStartedOverBy } from './reset-setup.ts';

const changedEveryTime = new Conflict({
  detail: 'The state changed while the command was decided',
  kind: 'concurrent_change',
});

async function aLedgerThatChangesUnderEveryCommand() {
  const { service } = memoryLedger();
  const runtime = await makeAppRuntime(
    Layer.succeed(Ledger, Ledger.of({ ...service, execute: () => Effect.fail(changedEveryTime) })),
  );
  onTestFinished(() => runtime.dispose());
  return runtime;
}

function signingOutCounted() {
  const counted = { times: 0 };
  return {
    providerRows: {
      endedEvery: () => {
        counted.times += 1;
        return Promise.resolve();
      },
    },
    times: () => counted.times,
  };
}

describe('an admin command whose ledger another writer changed at every try', () => {
  it('records nothing, signs no one out and refuses, so it can simply be run again', async () => {
    const settings = readSettingsOf({ LEDGER_FILE: ':memory:' });
    const signingOut = signingOutCounted();
    const runtime = await aLedgerThatChangesUnderEveryCommand();

    const said = await setupStartedOverBy(settings, (use) =>
      use({ settings, runtime, signIn: { providerRows: signingOut.providerRows } }),
    );

    expect([said.said, said.lines.length, signingOut.times()]).toEqual(['refused', 1, 0]);
  });

  it('refuses where the sign-out that follows the reopen cannot be confirmed, so it can simply be run again', async () => {
    const { service, layer } = memoryLedger();
    const runtime = await makeAppRuntime(layer);
    onTestFinished(() => runtime.dispose());
    const tie = { issuer: 'https://login.example.com', claim: 'tenant', value: 'acme', person: 'a-person' };
    await Effect.runPromise(requiredClaimSetBy({ registry: service }, tie));
    const settings = readSettingsOf({ LEDGER_FILE: ':memory:' });
    const providerRows = { endedEvery: () => Promise.reject(new Error('the sign-in store of the test is busy')) };

    const said = await setupStartedOverBy(settings, (use) => use({ settings, runtime, signIn: { providerRows } }));

    expect([said.said, said.lines.length]).toEqual(['refused', 1]);
  });

  it('makes no one an Admin and refuses, so it can simply be run again', async () => {
    const settings = readSettingsOf({ LEDGER_FILE: ':memory:' });
    const runtime = await aLedgerThatChangesUnderEveryCommand();
    const person = { person: 'a-person', emailAddress: 'ada@example.com', joinedAt: 1, updatedAt: 1 };
    const peopleRows = {
      kept: () => Promise.resolve(),
      listed: () => Promise.resolve([person]),
      found: () => Promise.resolve().then(Function.constUndefined),
      deleted: () => Promise.resolve(),
    };

    const said = await adminGrantedBy(['ada@example.com'], (use) => use({ settings, runtime, signIn: { peopleRows } }));

    expect([said.said, said.lines.length]).toEqual(['refused', 1]);
  });
});
