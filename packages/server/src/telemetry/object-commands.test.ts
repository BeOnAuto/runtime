import { once } from 'node:events';
import { createServer } from 'node:http';

import { sha256Of } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { contentStoreOf, type ComposedContentStore } from '../composition/content-store.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { spansIn, type ExportedSpan } from '../testing/telemetry/otlp-exports.ts';
import { receivingOtlp } from '../testing/telemetry/otlp-receiver.ts';
import { startTelemetry } from './start-telemetry.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const decodeAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

const clientKind = 3;

const unset = 0;

const failed = 2;

const bucketAttributes = { 'rpc.system': 'aws-api', 'rpc.service': 'S3', 'aws.s3.bucket': 'playbook-content' };

function isOfTheBucketAlone(url = '/'): boolean {
  return new URL(url, 'http://store').pathname.split('/').filter((segment) => segment !== '').length === 1;
}

async function aStoreHoldingNothing(): Promise<string> {
  const server = createServer((request, response) => {
    response.writeHead(isOfTheBucketAlone(request.url) ? 200 : 404).end();
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(async () => {
    server.close();
    await once(server, 'close');
  });
  return `http://127.0.0.1:${String(decodeAddress(server.address()).port)}`;
}

function composedOn(environment: Readonly<Record<string, string>>): Promise<ComposedContentStore> {
  vi.stubEnv('AWS_ACCESS_KEY_ID', 'an-access-key');
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'a-secret-access-key');
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const composing = contentStoreOf(readSettingsOf(environment));
  if (composing === undefined) {
    throw new TypeError('CONTENT_STORE_URL is set, so the content is kept in an object store');
  }
  return Effect.runPromise(composing);
}

async function spansOfAReadOfNothing(): Promise<readonly ExportedSpan[]> {
  const receiver = await receivingOtlp();
  onTestFinished(receiver.close);
  const environment = {
    CONTENT_STORE_URL: 's3://playbook-content/production',
    AWS_ENDPOINT_URL: await aStoreHoldingNothing(),
    AWS_REGION: 'us-east-1',
    OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
  };
  const telemetry = startTelemetry(readSettingsOf(environment).telemetry);
  const { reached, store } = await composedOn(environment);
  await Effect.runPromise(reached);
  await Effect.runPromise(store.content.get(alpha, sha256Of('{"kept":false}')));
  await telemetry.shutdown();
  return spansIn(receiver.received());
}

describe('a command the content store sends to its bucket, with telemetry on', () => {
  it('is a client span named for the command, naming the bucket and never the key of an object', async () => {
    const spans = await spansOfAReadOfNothing();

    expect(spans.map(({ name, kind, attributes, statusCode }) => [name, kind, attributes, statusCode])).toEqual([
      ['S3.HeadBucket', clientKind, { ...bucketAttributes, 'rpc.method': 'HeadBucket' }, unset],
      [
        'S3.GetObject',
        clientKind,
        { ...bucketAttributes, 'rpc.method': 'GetObject', 'error.type': 'NotFound' },
        failed,
      ],
    ]);
  });
});
