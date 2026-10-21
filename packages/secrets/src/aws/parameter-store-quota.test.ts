import { DateTime, Effect, Redacted } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import { serveFakeParameterStore } from '../fakes/fake-parameter-store.ts';
import { sealedKeeper } from '../keepers/sealed-keeper.ts';
import { sealedSecretStoreOn } from '../store/sealed-store.ts';
import { secretStoreOn } from '../store/secret-store.ts';
import { memoryRows } from '../testing/memory-rows.ts';
import { recordingCustodian } from '../testing/recording-custodian.ts';
import { parameterStoreKeeper } from './parameter-store-keeper.ts';

const fake = await serveFakeParameterStore();

afterAll(fake.close);

const prefix = `/auto-runtime/secrets-${crypto.randomUUID()}`;

const keeper = parameterStoreKeeper({
  prefix,
  region: 'eu-west-1',
  proxy: { enabled: false, environment: {} },
  credentials: { accessKeyId: 'an-access-key', secretAccessKey: 'a-secret-access-key' },
  endpoint: fake.url,
});

describe('a move into a Parameter Store past the parameters its account keeps', () => {
  it('stops at the first secret past them in the words of the service, the secrets moved before it moved and the rest where they were, and moves the rest once the account keeps more', async () => {
    const rows = memoryRows({ now: Effect.map(DateTime.now, DateTime.toEpochMillis) });
    const custodians = { current: recordingCustodian() };
    const ids = await Effect.runPromise(
      Effect.forEach(['first', 'second', 'third'], (value) =>
        sealedSecretStoreOn(rows, custodians).keep(Redacted.make(value)),
      ),
    );
    const moving = secretStoreOn(rows, { current: keeper, previous: sealedKeeper(custodians) }, custodians);
    fake.keepAtMost(1);

    const stopped = await Effect.runPromise(Effect.flip(moving.moved()));
    const keptBy = rows.kept().map(({ kept_by }) => kept_by);
    fake.keepAtMost(Number.POSITIVE_INFINITY);
    const resumed = await Effect.runPromise(moving.moved());

    expect(stopped).toMatchObject({
      _tag: 'secret_refused',
      because: 'over_the_keepers_quota',
      detail: `AWS Parameter Store refused to keep the parameter ${prefix}/${String(ids[1])}: ParameterLimitExceeded: The fake Parameter Store keeps no more parameters`,
    });
    expect(keptBy).toEqual(['aws-parameter-store', 'ledger', 'ledger']);
    expect(resumed).toBe(2);
    expect(ids.map((id) => fake.parameter(`${prefix}/${id}`)?.versions)).toEqual([['first'], ['second'], ['third']]);
  });
});
