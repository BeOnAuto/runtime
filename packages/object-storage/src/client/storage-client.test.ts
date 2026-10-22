import { once } from 'node:events';
import { createServer } from 'node:http';

import { sha256Of } from '@on.auto/operations';
import { alpha, generated, refusalOf } from '@on.auto/operations/testing';
import { Effect, Function, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { objectContentOn, objectStoreReached } from '../content/object-content.ts';
import { storageClientOf, storageWaits } from './storage-client.ts';

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
    const { content } = objectContentOn(() => client, location);
    const started = performance.now();

    const refused = await refusalOf(objectStoreReached(() => client, location));
    const read = Effect.runPromise(content.get(alpha, sha256Of('stalled')));
    await expect(read).rejects.toThrow('requestTimeout');
    const put = Effect.runPromise(content.put(alpha, (await generated(2_500_000)).content()));
    await expect(put).rejects.toThrow('requestTimeout');

    expect(refused.answer).toMatch(/^TimeoutError/u);
    expect(performance.now() - started).toBeLessThan(20_000);
  });
});
