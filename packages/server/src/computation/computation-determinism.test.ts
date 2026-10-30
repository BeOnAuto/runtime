import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { campaignPace, campaignRows } from '@on.auto/computation/testing';
import { Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const secondStore = postgresql === '' ? 'SQLite, as LEDGER_TEST_POSTGRESQL_URL is not set' : 'PostgreSQL';

interface RunIds {
  readonly pace: string;
  readonly churning: string;
}

const runIds: Readonly<Record<'cold' | 'warm' | 'restarted', RunIds>> = {
  cold: { pace: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', churning: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8c7a' },
  warm: { pace: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b', churning: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8c7b' },
  restarted: { pace: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c', churning: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8c7c' },
};

const churning = [
  '---',
  'language: typescript',
  '---',
  'export default function (input: any): Output {',
  '  let total = 0;',
  '  for (let round = 0; round < 2_000; round++) {',
  '    for (const row of input.rows) {',
  '      total = (total + row.cost_cents * round) % 1_000_003;',
  '    }',
  '  }',
  '  return { total };',
  '}',
].join('\n');

const decodeRun = Schema.decodeUnknownSync(
  Schema.Struct({
    status: Schema.Literal('succeeded'),
    output: Schema.Json,
    record: Schema.Struct({ work: Schema.Number, input_bytes: Schema.Number, output_bytes: Schema.Number }),
  }),
);

async function administer(statement: string): Promise<void> {
  const client = new Client({ connectionString: postgresql });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function onADatabaseOfItsOwn(): Promise<Readonly<Record<string, string>>> {
  const name = `computation_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administer(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(postgresql);
  database.pathname = `/${name}`;
  return { LEDGER_FILE: '', DATABASE_URL: database.href, SECRETS_KEY: secretsKey };
}

function secondEnvironment(): Promise<Readonly<Record<string, string>>> {
  return postgresql === '' ? Promise.resolve({}) : onADatabaseOfItsOwn();
}

function aLedgerFile(): Readonly<Record<string, string>> {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-computation-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return { LEDGER_FILE: join(directory, 'ledger.db') };
}

async function ranOnce(server: ReasoningServer, name: string, input: Schema.Json, runId: string) {
  await server.call('POST', `${alpha}/definitions/computation/${name}/run`, { body: { input, run_id: runId } });
  const { output, record } = decodeRun((await server.call('GET', `${alpha}/runs/${runId}`)).body);
  return { output, work: record.work, input_bytes: record.input_bytes, output_bytes: record.output_bytes };
}

async function ranIn(server: ReasoningServer, input: Schema.Json, ids: RunIds) {
  return {
    pace: await ranOnce(server, 'pace', input, ids.pace),
    churning: await ranOnce(server, 'churning', input, ids.churning),
  };
}

async function ranOn(server: ReasoningServer, input: Schema.Json) {
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/computation`, { body: { name: 'pace', source: campaignPace } });
  await server.call('POST', `${alpha}/definitions/computation`, { body: { name: 'churning', source: churning } });
  const cold = await ranIn(server, input, runIds.cold);
  const warm = await ranIn(server, input, runIds.warm);
  await server.stop();
  return { cold, warm };
}

async function ranAgainOn(server: ReasoningServer, input: Schema.Json) {
  const restarted = await ranIn(server, input, runIds.restarted);
  await server.stop();
  return restarted;
}

describe(`a computation function on SQLite, on ${secondStore} and after a restart`, () => {
  it('gives the same output for the same input, after the same work, in a cold worker, a warm one and after the server started again', async () => {
    const input = campaignRows(1000);
    const file = aLedgerFile();

    const first = await ranOn(await servingReasoning([], file), input);
    const restarted = await ranAgainOn(await servingReasoning([], file), input);
    const second = await ranOn(await servingReasoning([], await secondEnvironment()), input);

    expect(second).toEqual(first);
    expect(first.warm).toEqual(first.cold);
    expect(restarted).toEqual(first.cold);
    expect([first.cold.pace.work, first.cold.churning.work]).toEqual([0, 201]);
  });
});
