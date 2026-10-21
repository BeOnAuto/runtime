import { randomUUID } from 'node:crypto';

import { afterAll, describe } from 'vitest';

import { serveFakeParameterStore } from '../fakes/fake-parameter-store.ts';
import type { TestKeepers } from '../fakes/memory-keeper.ts';
import type { Holding } from '../rows/secret-rows.ts';
import { keeperBehaviour } from '../testing/keeper-behaviour.ts';
import { inMemoryEntry } from '../testing/secrets-entry.ts';
import { parameterStoreKeeper } from './parameter-store-keeper.ts';

const fake = await serveFakeParameterStore();

afterAll(fake.close);

const prefix = `/auto-runtime/secrets-${randomUUID()}`;

interface Selected {
  readonly name: string;
  readonly version: number;
}

function selectedBy({ held }: Holding): Selected {
  const separator = held.lastIndexOf(':');
  return { name: held.slice(0, separator), version: Number(held.slice(separator + 1)) };
}

const onTheFake: TestKeepers = {
  aKeeper: () =>
    Promise.resolve(
      parameterStoreKeeper({
        prefix,
        region: 'eu-west-1',
        proxy: { enabled: false, environment: {} },
        credentials: { accessKeyId: 'an-access-key', secretAccessKey: 'a-secret-access-key' },
        endpoint: fake.url,
      }),
    ),
  valueIn: (holding) => {
    const { name, version } = selectedBy(holding);
    return Promise.resolve(fake.parameter(name)?.versions[version - 1]);
  },
  lose: (holding) => {
    fake.remove(selectedBy(holding).name);
    return Promise.resolve();
  },
};

describe('the secret store over values kept in Parameter Store, each a SecureString parameter of its own', () => {
  keeperBehaviour(inMemoryEntry(), onTheFake);
});
