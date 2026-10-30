import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, noNetwork, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { tallied, tallyCreated } from '../testing/servers/tally-server.ts';
import { runIdIn, settledRun } from '../testing/servers/workflow-server.ts';

async function servedOver(ledger: TemporaryLedger): Promise<ReasoningServer> {
  const server = await servingReasoning([], {}, noNetwork, { ledger });
  onTestFinished(() => server.stop());
  return server;
}

async function settledTally(server: ReasoningServer): Promise<string> {
  const started = await tallied(server);
  await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);
  return runIdIn(started.body);
}

function historyChangedIn(ledger: TemporaryLedger, run: string): void {
  const database = new DatabaseSync(ledger.fileName);
  const stream = `playbook/acme/alpha/runs/${run.toLowerCase()}`;
  try {
    database.prepare("DELETE FROM emt_messages WHERE stream_id = ? AND message_type = 'run_started'").run(stream);
    database.prepare("UPDATE emt_messages SET message_data = '{not json' WHERE stream_id = ?").run(stream);
  } finally {
    database.close();
  }
}

describe('a runtime whose ledger lost or garbled the history of runs it ran', () => {
  it('goes on starting runs after it restarts, counting from its own record of what it admitted', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const before = await servedOver(ledger);
    await tallyCreated(before);
    const changed = await settledTally(before);
    await settledTally(before);
    await before.stop();
    historyChangedIn(ledger, changed);

    const after = await servedOver(ledger);
    const ran = await tallied(after);

    expect(ran.status).toBe(200);
    expect((await after.call('GET', '/v1/orgs/acme/license')).body).toMatchObject({
      state: 'unregistered',
      free_runs: { used: 3, of: 100 },
    });
  }, 60_000);
});
