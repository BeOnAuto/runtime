import { sha256Of } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readSettings } from '../settings/settings.ts';
import { loadKmsCustodians, type KmsCustodians } from './kms-custodians.ts';
import { custodiansOf } from './secret-store.ts';

const keyArn = 'arn:aws:kms:eu-central-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab';

const [current, previous] = [Buffer.alloc(32, 1), Buffer.alloc(32, 2)];

interface Asked {
  readonly keyId: string;
  readonly region: string;
  readonly credentials: string;
  readonly proxied: boolean;
}

function recordingLoader() {
  const asked: Asked[] = [];
  const loads = { made: 0 };
  const loaded: KmsCustodians = {
    kmsCustodian: ({ keyId, region, credentials, proxy }) => {
      asked.push({ keyId, region, credentials: typeof credentials, proxied: proxy.enabled });
      return Effect.succeed({ kid: `kms ${keyId}`, wrap: () => Effect.never, unwrap: () => Effect.never });
    },
  };
  return {
    loadKms: () => {
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

describe('the custodians of the secrets settings', () => {
  it('are custodians of keys in hand, and load nothing of KMS, where no setting names a key in KMS', async () => {
    const loader = recordingLoader();
    const settings = readSettings({
      SECRETS_KEY: current.toString('base64'),
      SECRETS_KEY_PREVIOUS: previous.toString('base64'),
    });

    const custodians = await custodiansOf(settings.secrets, { proxy: settings.proxy, loadKms: loader.loadKms });
    const alone = await custodiansOf(readSettings({ LEDGER_FILE: ':memory:' }).secrets, {
      proxy: settings.proxy,
      loadKms: loader.loadKms,
    });

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
    const inKms = readSettings({
      SECRETS_KEY_KMS: keyArn,
      SECRETS_KEY_PREVIOUS: previous.toString('base64'),
      NODE_USE_ENV_PROXY: '1',
    });
    const outOfKms = readSettings({ SECRETS_KEY: current.toString('base64'), SECRETS_KEY_KMS_PREVIOUS: keyArn });

    const intoKms = await custodiansOf(inKms.secrets, { proxy: inKms.proxy, loadKms: loader.loadKms });
    const back = await custodiansOf(outOfKms.secrets, { proxy: outOfKms.proxy, loadKms: loader.loadKms });

    expect([intoKms.current.kid, intoKms.previous?.kid, back.current.kid, back.previous?.kid]).toEqual([
      `kms ${keyArn}`,
      kidOf(previous),
      kidOf(current),
      `kms ${keyArn}`,
    ]);
    expect(loader.asked()).toEqual([
      { keyId: keyArn, region: 'eu-central-1', credentials: 'function', proxied: true },
      { keyId: keyArn, region: 'eu-central-1', credentials: 'function', proxied: false },
    ]);
    expect(loader.loads()).toBe(2);
  });

  it('load the custodian of KMS from its own subpath of the secrets package', async () => {
    const { kmsCustodian } = await loadKmsCustodians();

    const made = await Effect.runPromise(
      kmsCustodian({
        keyId: keyArn,
        region: 'eu-central-1',
        proxy: { enabled: false, environment: {} },
        credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
      }),
    );

    expect(made.kid).toBe('1234abcd-12ab-34cd-56ef-1234567890ab');
  });
});
