import { randomUUID } from 'node:crypto';

import { messageIdOf } from '@on.auto/operations';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { onPostgreSQLAt } from '../testing/host-files.ts';
import { describeOnPostgreSQL } from '../testing/postgresql-databases.ts';
import { rowsSuite } from '../views-testing/rows-suite.ts';
import { collecting, foldedAll, isLive } from '../views-testing/view-documents.ts';
import { viewHarness } from '../views-testing/view-harness.ts';

async function aRunLeftOpen(connectionString: string, output: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  onTestFinished(() => client.end());
  const runId = randomUUID();
  const stream = `playbook/acme/alpha/runs/${runId}`;
  const context = {
    at: '2026-10-06T10:00:00.000Z',
    by: 'acme-admin',
    runId,
    definitionType: 'reasoning',
    definitionName: 'late',
    definitionVersion: 1,
  };
  const event = { output, record: {} };
  const metadata = { messageId: messageIdOf(stream, 1), causationId: null, correlationId: null, ...context };
  await client.query('BEGIN');
  await client.query(
    `SELECT success FROM emt_append_to_stream(
      ARRAY[$4], ARRAY[$1::jsonb], ARRAY[$5::jsonb], ARRAY['1'], ARRAY['run_succeeded'], ARRAY['E'], $2, 'playbook', $3, 'emt:default')`,
    [{ json: JSON.stringify(event) }, stream, 0, metadata.messageId, metadata],
  );
  return client;
}

describeOnPostgreSQL('the views of the projector', (aDatabase) => {
  rowsSuite(async () => onPostgreSQLAt(await aDatabase()));

  describe('an event committed late', () => {
    it('is folded once it is committed, in the order the ledger recorded it, never passed over', async () => {
      const connectionString = await aDatabase();
      const views = await viewHarness(onPostgreSQLAt(connectionString));
      await views.saved('outputs', collecting);
      views.start();
      await views.folded('outputs', isLive);
      const open = await aRunLeftOpen(connectionString, 'late');

      await views.ran('reasoning/after', 'after');
      await views.sweptOnce();
      const held = await views.viewOf('outputs');
      await open.query('COMMIT');
      const folded = await views.folded('outputs', foldedAll(2));

      expect([held?.view, folded.view]).toEqual([[], ['late', 'after']]);
    });
  });
});
