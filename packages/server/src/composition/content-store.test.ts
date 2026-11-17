import { fileURLToPath } from 'node:url';

import { sha256Of, textToKeep } from '@on.auto/content';
import { memoryContentStore } from '@on.auto/content/testing';
import { statementOf } from '@on.auto/ledger';
import { Ledger, streamPrefixOfOrg, streamPrefixOfPlaybook } from '@on.auto/operations';
import { modulesReachedFrom } from '@on.auto/operations/testing';
import { Effect, ManagedRuntime } from 'effect';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { ledgerDatabaseOf } from '../database/ledger-database.ts';
import { onTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { aStoreAnswering } from '../testing/servers/answering-store.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { contentStoreOf } from './content-store.ts';
import { ledgerLayerFor, ledgerLayerOf } from './ledger-store.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const secret = 'a-secret-access-key';

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
  const runtime = ManagedRuntime.make(ledgerLayerFor(settings, await ledgerDatabaseOf(settings), { declared: [] }));
  onTestFinished(() => runtime.dispose());
  return runtime.runPromise(Ledger);
}

const sources = fileURLToPath(new URL('..', import.meta.url));

function objectStorageReachedFrom(module: string): readonly string[] {
  return modulesReachedFrom(sources, module).packages.filter((name) => name.startsWith('@on.auto/object-storage'));
}

const placeOfItsOrg = streamPrefixOfOrg(alpha);

const heldDigest = 'a'.repeat(64);

async function opened(environment: Readonly<Record<string, string>>): Promise<void> {
  const settings = readSettingsOf(environment);
  const runtime = ManagedRuntime.make(ledgerLayerFor(settings, await ledgerDatabaseOf(settings), { declared: [] }));
  try {
    await runtime.runPromise(Ledger);
  } finally {
    await runtime.dispose();
  }
}

async function aLedgerHoldingContentOutside(ledger: TemporaryLedger): Promise<void> {
  await opened({ LEDGER_FILE: ledger.fileName });
  const playbook = streamPrefixOfPlaybook({ org: 'acme', playbook: 'alpha' });
  const org = streamPrefixOfOrg({ org: 'acme' });
  await onTheLedgerIn(ledger.fileName, async (connection) => {
    await connection.write(
      statementOf(
        [
          'INSERT INTO content_references_2 (org_key, playbook_key, stream, sha256, held) VALUES (',
          ', ',
          ", 'notes/n1', ",
          ', 1)',
        ],
        [org, playbook, heldDigest],
      ),
    );
    await connection.write(
      statementOf(
        [
          'INSERT INTO recorded_content_heads (org_key, sha256, place_key, upload_id, bytes, chunks, media_type, kept_in) VALUES (',
          ', ',
          ', ',
          ", '', 20, 0, 'application/json', 'external')",
        ],
        [org, heldDigest, org],
      ),
    );
    await connection.write(
      statementOf(
        ['INSERT INTO recorded_content_places (org_key, sha256, place_key) VALUES (', ', ', ', ', ')'],
        [org, heldDigest, org],
      ),
    );
  });
}

describe('the store the content of a playbook is kept in', () => {
  it("is the ledger's own when no object store is set", () => {
    expect(contentStoreOf(readSettingsOf({}))).toBeUndefined();
  });

  it('is an object store when CONTENT_STORE_URL is set, whose bucket is checked before the ledger opens', async () => {
    const reachable = await aStoreAnswering(200);

    const ledger = await ledgerOn(reachable);

    expect(Object.keys(ledger.content)).toEqual(['put', 'get', 'getHead', 'getPart']);
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
});

describe('the entries of the object store the server imports as it starts', () => {
  it('are the entry of the location alone, which the settings read, and the adapter only when they name a bucket', () => {
    expect(objectStorageReachedFrom('lifecycle/run-server.ts')).toEqual(['@on.auto/object-storage/location']);
    expect(objectStorageReachedFrom('composition/composition-root.ts')).toEqual([]);
  });
});

describe('a ledger given a content store of its own', () => {
  it('keeps what the ledger is given to keep, and reads it back, in the store it is composed with, under the org of its playbook', async () => {
    const store = memoryContentStore();
    const runtime = ManagedRuntime.make(
      ledgerLayerOf(await ledgerDatabaseOf(readSettingsOf({ LEDGER_FILE: ':memory:' })), { content: store }),
    );
    onTestFinished(() => runtime.dispose());

    const kept = await runtime.runPromise(
      Effect.flatMap(Ledger, (ledger) => ledger.content.put(alpha, textToKeep('{"kept":true}', 'application/json'))),
    );

    expect(await Effect.runPromise(store.read(placeOfItsOrg, kept.sha256))).toMatchObject({ bytes: 13 });
  });
});

describe('a server whose bucket fails the look at the content its ledger names, as it starts', () => {
  it('stops in the words of a bucket that could not be reached, naming the setting, the bucket and the host and no credential', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    await aLedgerHoldingContentOutside(ledger);
    const host = await aStoreAnswering(200, 403);
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'an-access-key');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'a-secret-access-key');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });

    const failure = await opened({
      LEDGER_FILE: ledger.fileName,
      CONTENT_STORE_URL: 's3://playbook-content/production',
      AWS_ENDPOINT_URL: `http://${host}`,
      AWS_REGION: 'us-east-1',
    }).catch((error: unknown) => error);

    expect(String(failure)).toMatch(
      new RegExp(
        `CONTENT_STORE_URL names the bucket playbook-content on ${host.replaceAll('.', '\\.')}, which could not be reached: \\w+ \\(403\\)`,
        'u',
      ),
    );
    expect(String(failure)).not.toContain('a-secret-access-key');
  });
});
