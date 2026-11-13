import { statementOf } from '@on.auto/ledger';
import { Ledger, streamPrefixOfPlaybook } from '@on.auto/operations';
import { ManagedRuntime } from 'effect';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { ledgerDatabaseOf } from '../database/ledger-database.ts';
import { onTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { aStoreAnswering } from '../testing/servers/answering-store.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { ledgerLayerFor } from './ledger-store.ts';

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
  await onTheLedgerIn(ledger.fileName, async (connection) => {
    await connection.write(
      statementOf(
        ['INSERT INTO content_references_1 (playbook_key, stream, sha256, held) VALUES (', ", 'notes/n1', ", ', 1)'],
        [playbook, heldDigest],
      ),
    );
    await connection.write(
      statementOf(
        [
          'INSERT INTO recorded_content_heads (playbook_key, sha256, upload_id, bytes, chunks, media_type, kept_in) VALUES (',
          ', ',
          ", '', 20, 0, 'application/json', 'external')",
        ],
        [playbook, heldDigest],
      ),
    );
  });
}

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
