import { once } from 'node:events';
import { createServer } from 'node:http';

import { Ledger, sha256Of, textToKeep } from '@on.auto/operations';
import { memoryRecordedContent } from '@on.auto/operations/testing';
import { Effect, ManagedRuntime, Schema } from 'effect';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { ledgerDatabaseOf } from '../database/ledger-database.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { contentStoreOf } from './content-store.ts';
import { ledgerLayerFor, ledgerLayerOf } from './ledger-store.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const secret = 'a-secret-access-key';

const decodeAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

function isOfTheBucketAlone(url = '/'): boolean {
  return new URL(url, 'http://store').pathname.split('/').filter((segment) => segment !== '').length === 1;
}

async function aStoreAnswering(status: number): Promise<string> {
  const server = createServer((request, response) => {
    response.writeHead(isOfTheBucketAlone(request.url) ? status : 404).end();
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(async () => {
    server.close();
    await once(server, 'close');
  });
  return `127.0.0.1:${String(decodeAddress(server.address()).port)}`;
}

async function ledgerOn(host: string): Promise<Ledger['Service']> {
  vi.stubEnv('AWS_ACCESS_KEY_ID', 'an-access-key');
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', secret);
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const settings = readSettingsOf({
    LEDGER_FILE: ':memory:',
    CONTENT_STORE_URL: 's3://playbook-content/production',
    AWS_ENDPOINT_URL: `http://${host}`,
    AWS_REGION: 'us-east-1',
  });
  const runtime = ManagedRuntime.make(ledgerLayerFor(settings, await ledgerDatabaseOf(settings)));
  onTestFinished(() => runtime.dispose());
  return runtime.runPromise(Ledger);
}

describe('the store the content of a playbook is kept in', () => {
  it("is the ledger's own when no object store is set", () => {
    expect(contentStoreOf(readSettingsOf({}))).toBeUndefined();
  });

  it('is an object store when CONTENT_STORE_URL is set, whose bucket is checked before the ledger opens', async () => {
    const reachable = await aStoreAnswering(200);

    const ledger = await ledgerOn(reachable);

    expect(Object.keys(ledger.content)).toEqual(['put', 'get', 'stage', 'staged', 'unstage']);
  });

  it('reads through the client it is composed with, answering nothing for a digest its bucket does not hold', async () => {
    const ledger = await ledgerOn(await aStoreAnswering(200));

    expect(await Effect.runPromise(ledger.content.get(alpha, sha256Of('{"kept":false}')))).toBeUndefined();
  });

  it('stops the ledger from opening when its bucket answers with a refusal, naming the setting, the bucket and the host', async () => {
    const refusing = await aStoreAnswering(403);

    const opening = ledgerOn(refusing);

    await expect(opening).rejects.toThrow(
      new RegExp(
        `^CONTENT_STORE_URL names the bucket playbook-content on ${refusing}, which could not be reached: \\w+ \\(403\\)$`,
        'u',
      ),
    );
    await expect(opening).rejects.not.toThrow(secret);
  });

  it('keeps what the ledger is given to keep, and reads it back, in the store it is composed with', async () => {
    const content = memoryRecordedContent();
    const runtime = ManagedRuntime.make(
      ledgerLayerOf(await ledgerDatabaseOf(readSettingsOf({ LEDGER_FILE: ':memory:' })), undefined, {
        content,
        sweepContent: () => Promise.resolve(),
      }),
    );
    onTestFinished(() => runtime.dispose());

    const kept = await runtime.runPromise(
      Effect.flatMap(Ledger, (ledger) => ledger.content.put(alpha, textToKeep('{"kept":true}', 'application/json'))),
    );

    expect(await Effect.runPromise(content.get(alpha, kept.sha256))).toMatchObject({ bytes: 13 });
  });
});
