import { once } from 'node:events';
import { createServer } from 'node:http';

import { sha256Of } from '@on.auto/content';
import { generated } from '@on.auto/content/testing';
import { Effect, Function, Schema, Struct } from 'effect';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { objectContentOn } from '../content/object-content.ts';
import { objectStoreReached } from '../s3/object-store-reached.ts';
import { bucketOnS3 } from '../s3/s3-bucket.ts';
import { storageClientOf, storageWaits } from './storage-client.ts';

const alphaPlace = 'playbook/acme/alpha/';

const decodeAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

async function aStoreThatNeverAnswers(): Promise<string> {
  const server = createServer(Function.constVoid).listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(async () => {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  });
  return `http://127.0.0.1:${String(decodeAddress(server.address()).port)}`;
}

async function onFakeTime(work: Promise<string>): Promise<{ readonly said: string; readonly ms: number }> {
  const waited = { ms: 0, said: '' };
  const settled = work.then(
    (said) => Object.assign(waited, { said }),
    (failure: unknown) => Object.assign(waited, { said: String(failure) }),
  );
  const stepped = async (): Promise<void> => {
    if (waited.said !== '') {
      return;
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    await vi.advanceTimersByTimeAsync(10);
    waited.ms += 10;
    await stepped();
  };
  await stepped();
  await settled;
  return waited;
}

const credentials = { accessKeyId: 'access', secretAccessKey: 'secret' };

const noProxy = { enabled: false, environment: {} };

describe('the client of an object store', () => {
  it('addresses a custom endpoint by path, in the region it is given', async () => {
    const client = storageClientOf(
      { endpoint: 'http://127.0.0.1:9000', region: 'eu-west-1', proxy: noProxy },
      credentials,
    );

    expect([
      client.config.forcePathStyle,
      await client.config.region(),
      (await client.config.endpoint?.())?.hostname,
    ]).toEqual([true, 'eu-west-1', '127.0.0.1']);
  });

  it('addresses the endpoint of its region by host without a custom endpoint, and checksums only what the API requires', async () => {
    const client = storageClientOf({ endpoint: undefined, region: 'eu-west-1', proxy: noProxy }, credentials);

    expect([
      client.config.forcePathStyle,
      client.config.endpoint,
      await client.config.requestChecksumCalculation(),
      await client.config.responseChecksumValidation(),
    ]).toEqual([false, undefined, 'WHEN_REQUIRED', 'WHEN_REQUIRED']);
  });

  it('leaves the region to the default chain of the AWS SDK when none is given', () => {
    const client = storageClientOf(
      {
        endpoint: undefined,
        region: undefined,
        proxy: { enabled: true, environment: { HTTPS_PROXY: 'http://proxy:3128' } },
      },
      credentials,
    );

    expect(typeof client.config.region).toBe('function');
  });
});

describe('the client of an object store that stops answering', () => {
  it('gives up on each request after its wait of 100 ms, so no check, read or put of a stalled store waits for ever', async () => {
    const endpoint = await aStoreThatNeverAnswers();
    const client = storageClientOf({ endpoint, region: 'us-east-1', proxy: noProxy }, credentials, {
      ...storageWaits,
      requestMs: 100,
    });
    const location = { bucket: 'content', prefix: '' };
    const objects = objectContentOn(bucketOnS3({ client: () => client, name: location.bucket }), location);
    const content = (await generated(2_500_000)).content();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    onTestFinished(() => {
      vi.useRealTimers();
    });

    const refused = await onFakeTime(
      Effect.runPromise(objectStoreReached(() => client, location).pipe(Effect.flip, Effect.map(Struct.get('answer')))),
    );
    const read = await onFakeTime(Effect.runPromise(objects.read(alphaPlace, sha256Of('stalled'))).then(() => 'read'));
    const put = await onFakeTime(Effect.runPromise(objects.stage(alphaPlace, content)).then(() => 'put'));

    expect(refused.said).toMatch(/^TimeoutError/u);
    expect([read.said, put.said]).toEqual([
      expect.stringContaining('requestTimeout'),
      expect.stringContaining('requestTimeout'),
    ]);
    expect(Math.max(refused.ms, read.ms, put.ms)).toBeLessThan(storageWaits.requestMs);
  });
});
