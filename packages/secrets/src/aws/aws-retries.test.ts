import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { fakeParameterStoreInProcess } from '../fakes/fake-parameter-store.ts';
import { retriesOnATimer } from '../fakes/retries-on-a-timer.ts';
import { kmsClientConfigOf } from './kms-custodian.ts';
import { parameterStoreKeeper, ssmClientConfigOf } from './parameter-store-keeper.ts';

const credentials = { accessKeyId: 'an-access-key', secretAccessKey: 'a-secret-access-key' };

const noProxy = { enabled: false, environment: {} };

const kms = { keyId: 'alias/auto-runtime', region: 'eu-west-1', proxy: noProxy, credentials };

const ssm = { prefix: '/auto-runtime/secrets', region: 'eu-west-1', proxy: noProxy, credentials };

describe('the retries of the AWS clients', () => {
  it('are left to the SDK unless the custodian or the keeper is given a strategy, which is passed on as it is', () => {
    const { retryStrategyOf } = retriesOnATimer();

    expect(['retryStrategy' in kmsClientConfigOf(kms), 'retryStrategy' in ssmClientConfigOf(ssm)]).toEqual([
      false,
      false,
    ]);
    expect(ssmClientConfigOf(ssm).retryMode).toBeDefined();
    expect([
      kmsClientConfigOf({ ...kms, retryStrategyOf }).retryStrategy,
      ssmClientConfigOf({ ...ssm, retryStrategyOf }).retryStrategy,
    ]).toEqual([retryStrategyOf(), retryStrategyOf()]);
  });

  it('send a throttled write again once the pause of its strategy ends, and keep the value then', async () => {
    const fake = fakeParameterStoreInProcess({ region: 'eu-west-1', account: '111122223333' });
    const retries = retriesOnATimer();
    const keeper = parameterStoreKeeper({
      ...ssm,
      endpoint: fake.url,
      requestHandlerOf: fake.requestHandlerOf,
      retryStrategyOf: retries.retryStrategyOf,
    });
    fake.throttle();

    const holding = Effect.runPromise(keeper.hold('secret-1', Redacted.make('pasted-key')));
    await retries.paused(1);
    const sentBeforeThePause = retries.attempts();
    retries.fire();

    expect((await holding).held).toBe('/auto-runtime/secrets/secret-1:1');
    expect([sentBeforeThePause, retries.attempts()]).toEqual([1, 2]);
  });
});
