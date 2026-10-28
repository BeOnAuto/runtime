import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it, onTestFinished } from 'vitest';

import { runtimeIdOf } from '../testing/accounts/licensed-server.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, noNetwork, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { tallied, tallyCreated } from '../testing/servers/tally-server.ts';
import { runIdIn, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

const studio = 'https://studio.example.com';

async function servedOver(ledger: TemporaryLedger): Promise<ReasoningServer> {
  const server = await servingReasoning([], { STUDIO_ORIGIN: studio }, noNetwork, { ledger });
  onTestFinished(() => server.stop());
  return server;
}

async function settledTally(server: ReasoningServer): Promise<string> {
  const started = await tallied(server);
  await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);
  return runIdIn(started.body);
}

function startDeletedOf(ledger: TemporaryLedger, run: string): void {
  const database = new DatabaseSync(ledger.fileName);
  try {
    database
      .prepare("DELETE FROM emt_messages WHERE stream_id = ? AND message_type = 'run_started'")
      .run(`playbook/acme/alpha/runs/${run.toLowerCase()}`);
  } finally {
    database.close();
  }
}

describe('a runtime whose ledger lost a run its meter counted', () => {
  it('refuses every run after it restarts as a metering fault linking support, and still reads, edits and exports', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const before = await servedOver(ledger);
    await tallyCreated(before);
    const counted = await settledTally(before);
    await settledTally(before);
    await before.stop();
    startDeletedOf(ledger, counted);

    const after = await servedOver(ledger);
    const refused = await after.call('POST', `${alpha}/definitions/workflow/tally/run`, { body: { input: {} } });
    const edited = await after.call('POST', `${alpha}/definitions/workflow`, {
      body: { name: 'later', source: workflowSource('later', 'do:\n  - wait:\n      set: { waited: true }\n') },
    });

    const runtimeId = await runtimeIdOf(after);
    expect(refused).toMatchObject({
      status: 409,
      body: { kind: 'metering_fault', resolve_at: `${studio}/support`, runtime_id: runtimeId },
    });
    expect(JSON.stringify(refused.body)).toContain(`see ${studio}/support (runtime id ${runtimeId})`);
    expect([edited.status, (await after.call('GET', `${alpha}/runs`)).status]).toEqual([201, 200]);
    expect((await after.call('GET', `${alpha}/events`)).status).toBe(200);
  }, 60_000);
});
