import { mostInlinePayloadBytes } from '@on.auto/operations/payloads';
import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { everyRowSet, onTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, loopbackSettingsOver, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { ledgerRefusalIn } from './ledger-refusals.ts';

const longDocument = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  '---',
  `Sum up the day. ${'Keep each line short and plain. '.repeat(Math.ceil(mostInlinePayloadBytes / 32))}`,
].join('\n');

async function aDocumentOffloadedIn(ledger: TemporaryLedger): Promise<void> {
  const saving = await servingReasoning([], {}, undefined, { ledger });
  await saving.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await saving.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'summary', source: longDocument, diagram: 'none' },
  });
  await saving.stop();
}

function startedOver(ledger: TemporaryLedger): Promise<unknown> {
  return startServer(loopbackSettingsOver(ledger), compositionRoot).then(
    (server) => server.stop(),
    (failure: unknown) => failure,
  );
}

describe('a server over a ledger whose records name content', () => {
  it('starts where that content is where it keeps content', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    await aDocumentOffloadedIn(ledger);

    expect(await startedOver(ledger)).toBeUndefined();
  }, 60_000);

  it('does not start where that content is kept elsewhere, and says where and what to do', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    await aDocumentOffloadedIn(ledger);
    await onTheLedgerIn(ledger.fileName, (connection) =>
      connection.write(everyRowSet('recorded_content_heads', { kept_in: 'external' })),
    );

    const refusal = ledgerRefusalIn(await startedOver(ledger));

    expect(refusal?.happened).toBe(
      `The ledger is kept in the file ${ledger.fileName}, and its records name content this server cannot find. Content is kept in the ledger's database, since CONTENT_STORE_URL is not set, but 1 of the 1 it looked for is kept on object storage.`,
    );
  }, 60_000);
});
