import { sha256Of } from '@on.auto/operations';
import type { Keeper } from '@on.auto/secrets';
import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { type Settings } from '../settings/settings.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { loadAwsAdapters, type AwsAdapters } from './aws-adapters.ts';
import { keepersOf } from './secret-keepers.ts';
import { custodiansOf } from './secret-store.ts';

const keyArn = 'arn:aws:kms:eu-central-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab';

const [current, previous] = [Buffer.alloc(32, 1), Buffer.alloc(32, 2)];

interface Asked {
  readonly id: string;
  readonly region: string;
  readonly credentials: string;
  readonly proxied: boolean;
}

const unanswering: Keeper = {
  name: 'aws-parameter-store',
  hold: () => Effect.never,
  reveal: () => Effect.never,
  release: () => Effect.never,
};

function recordingLoader() {
  const asked: Asked[] = [];
  const loads = { made: 0 };
  const loaded: AwsAdapters = {
    kmsCustodian: ({ keyId, region, credentials, proxy }) => {
      asked.push({ id: keyId, region, credentials: typeof credentials, proxied: proxy.enabled });
      return Effect.succeed({ kid: `kms ${keyId}`, wrap: () => Effect.never, unwrap: () => Effect.never });
    },
    parameterStoreKeeper: ({ prefix, region, credentials, proxy }) => {
      asked.push({ id: prefix, region, credentials: typeof credentials, proxied: proxy.enabled });
      return unanswering;
    },
  };
  return {
    loadAws: () => {
      loads.made += 1;
      return Promise.resolve(loaded);
    },
    asked: () => [...asked],
    loads: () => loads.made,
  };
}

function kidOf(key: Readonly<Uint8Array>): string {
  return sha256Of(key).slice(0, 16);
}

function custodiansFor(settings: Pick<Settings, 'secrets' | 'proxy'>, loadAws: () => Promise<AwsAdapters>) {
  return custodiansOf(Option.getOrThrow(Option.fromNullishOr(settings.secrets)), { proxy: settings.proxy, loadAws });
}

describe('the custodians of the secrets settings', () => {
  it('are custodians of keys in hand, and load nothing of AWS, where no setting names a key in KMS', async () => {
    const loader = recordingLoader();
    const settings = readSettingsOf({
      SECRETS_KEY: current.toString('base64'),
      SECRETS_KEY_PREVIOUS: previous.toString('base64'),
    });

    const custodians = await custodiansFor(settings, loader.loadAws);
    const alone = await custodiansFor(readSettingsOf({ LEDGER_FILE: ':memory:' }), loader.loadAws);

    expect([custodians.current.kid, custodians.previous?.kid, alone.previous]).toEqual([
      kidOf(current),
      kidOf(previous),
      undefined,
    ]);
    expect(alone.current.kid).toMatch(/^[\da-f]{16}$/u);
    expect(loader.loads()).toBe(0);
  });
});

describe('the custodians of the secrets settings that name a key in KMS', () => {
  it('load the custodian of KMS where a setting names a key there, for the key the ARN names in its region, with the default credential chain and the proxy settings', async () => {
    const loader = recordingLoader();
    const inKms = readSettingsOf({
      SECRETS_KEY_KMS: keyArn,
      SECRETS_KEY_PREVIOUS: previous.toString('base64'),
      NODE_USE_ENV_PROXY: '1',
    });
    const outOfKms = readSettingsOf({ SECRETS_KEY: current.toString('base64'), SECRETS_KEY_KMS_PREVIOUS: keyArn });

    const intoKms = await custodiansFor(inKms, loader.loadAws);
    const back = await custodiansFor(outOfKms, loader.loadAws);

    expect([intoKms.current.kid, intoKms.previous?.kid, back.current.kid, back.previous?.kid]).toEqual([
      `kms ${keyArn}`,
      kidOf(previous),
      kidOf(current),
      `kms ${keyArn}`,
    ]);
    expect(loader.asked()).toEqual([
      { id: keyArn, region: 'eu-central-1', credentials: 'function', proxied: true },
      { id: keyArn, region: 'eu-central-1', credentials: 'function', proxied: false },
    ]);
    expect(loader.loads()).toBe(2);
  });

  it('load the custodian of KMS and the keeper of Parameter Store from the aws subpath of the secrets package', async () => {
    const { kmsCustodian, parameterStoreKeeper } = await loadAwsAdapters();
    const proxy = { enabled: false, environment: {} };
    const credentials = { accessKeyId: 'a', secretAccessKey: 'b' };

    const made = await Effect.runPromise(kmsCustodian({ keyId: keyArn, region: 'eu-central-1', proxy, credentials }));
    const keeper = parameterStoreKeeper({
      prefix: '/auto-runtime/secrets',
      region: 'eu-central-1',
      proxy,
      credentials,
    });

    expect([made.kid, keeper.name]).toEqual(['1234abcd-12ab-34cd-56ef-1234567890ab', 'aws-parameter-store']);
  });
});

describe('the keepers of the secrets settings', () => {
  it('are the keeper that seals into the ledger under the custodians, and load nothing of AWS, where no setting names a secret manager', async () => {
    const loader = recordingLoader();
    const settings = readSettingsOf({ SECRETS_KEY: current.toString('base64') });
    const custodians = await custodiansFor(settings, loader.loadAws);

    const keepers = await keepersOf(settings.keepers, custodians, { proxy: settings.proxy, loadAws: loader.loadAws });

    expect([keepers.current.name, keepers.previous]).toEqual(['ledger', undefined]);
    expect(loader.loads()).toBe(0);
  });

  it('load the keeper of Parameter Store where a setting names it, current or previous, for its prefix in the region of the settings, with the default credential chain and the proxy settings', async () => {
    const loader = recordingLoader();
    const making = { loadAws: loader.loadAws };
    const alone = readSettingsOf({
      SECRETS_KEEPER: 'aws-parameter-store:/auto-runtime/secrets',
      AWS_REGION: 'eu-west-1',
    });
    const back = readSettingsOf({
      SECRETS_KEEPER: 'ledger',
      SECRETS_KEEPER_PREVIOUS: 'aws-parameter-store:/auto-runtime/secrets',
      SECRETS_KEY: current.toString('base64'),
      AWS_DEFAULT_REGION: 'eu-north-1',
      NODE_USE_ENV_PROXY: '1',
    });

    const inTheManager = await keepersOf(alone.keepers, undefined, { ...making, proxy: alone.proxy });
    const movingBack = await keepersOf(back.keepers, await custodiansFor(back, loader.loadAws), {
      ...making,
      proxy: back.proxy,
    });

    expect([inTheManager.current, inTheManager.previous]).toEqual([unanswering, undefined]);
    expect([movingBack.current.name, movingBack.previous]).toEqual(['ledger', unanswering]);
    expect(loader.asked()).toEqual([
      { id: '/auto-runtime/secrets', region: 'eu-west-1', credentials: 'function', proxied: false },
      { id: '/auto-runtime/secrets', region: 'eu-north-1', credentials: 'function', proxied: true },
    ]);
  });
});
