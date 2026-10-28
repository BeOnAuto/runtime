import { createHash } from 'node:crypto';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { accountsServed, installation, servedBy } from '../testing/accounts/licensed-server.ts';
import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const payroll = '/v1/orgs/acme/playbooks/payroll-of-ada';

const paying = workflowSource(
  'pay-ada-lovelace',
  'do:\n  - pay: { call: run_definition, with: { type: workflow, name: tally-ada-hours } }\n',
);

const tallying = workflowSource('tally-ada-hours', 'do:\n  - count:\n      set: { counted: true }\n');

const iban = 'GB33BUKB20201555555555';

const StartedBySchema = Schema.Struct({ started_by: Schema.Struct({ id: Schema.String, name: Schema.String }) });

const startedByIn = Schema.decodeUnknownSync(StartedBySchema);

const fieldsByCall: Readonly<Record<string, readonly string[]>> = {
  '/v1/installations/activate': ['actions', 'installation', 'last'],
  '/v1/installations/actions': ['action'],
  '/v1/installations/reports': ['actions', 'last'],
};

function digestOf(where: string): string {
  return createHash('sha256').update(where).digest('hex');
}

function digestIn(body: unknown): string {
  return String(Reflect.get(new Object(body), 'action'));
}

function fieldsOf(body: unknown): readonly string[] {
  return typeof body === 'object' && body !== null ? Object.keys(body).toSorted() : [];
}

async function payrollStarted(server: ReasoningServer): Promise<string> {
  await server.call('POST', '/v1/orgs/acme/playbooks', {
    body: { playbook: 'payroll-of-ada', name: 'Payroll of Ada Lovelace' },
  });
  await server.call('POST', `${payroll}/definitions/workflow`, {
    body: { name: 'pay-ada-lovelace', source: paying },
  });
  await server.call('POST', `${payroll}/definitions/workflow`, {
    body: { name: 'tally-ada-hours', source: tallying },
  });
  const started = await server.call('POST', `${payroll}/definitions/workflow/pay-ada-lovelace/run`, {
    body: { input: { iban, employee: 'Ada Lovelace' } },
  });
  return runIdIn(started.body);
}

describe('what a licensed runtime sends Auto as it activates, admits each run and reports', () => {
  it('sends the fields each call names alone: never a name of its org, playbook or definitions, its caller, a run id, an input or an output', async () => {
    const accounts = await accountsServed();
    const server = await servedBy(accounts, { AUTO_RUNTIME_LICENSE_KEY: accounts.key });
    const run = await payrollStarted(server);
    const settled = await settledRun(server, `${payroll}/runs/${run}`);
    const { started_by: startedBy } = startedByIn(settled.body);
    await until(() => accounts.account.charged().length === 2);
    await server.stop();
    const received = accounts.received();
    const sent = JSON.stringify(received.map(({ body }) => body));
    const admitted = received.filter(({ path }) => path === '/v1/installations/actions').map(({ body }) => body);

    expect(settled).toMatchObject({ body: { status: 'succeeded' } });
    expect(received.map(({ path }) => path)).toEqual(expect.arrayContaining(Object.keys(fieldsByCall)));
    expect(received.map(({ path, body }) => ({ path, fields: fieldsOf(body) }))).toEqual(
      received.map(({ path }) => ({ path, fields: fieldsByCall[path] })),
    );
    expect(admitted.map((body) => digestIn(body))).toContain(digestOf(`acme/payroll-of-ada/${run}`));
    expect(admitted.filter((body) => /^[0-9a-f]{64}$/u.test(digestIn(body)))).toHaveLength(2);
    expect(accounts.account.charged()[0]).toBe(
      `installation:${installation}/${digestOf(`acme/payroll-of-ada/${run}`)}`,
    );
    for (const named of [
      iban,
      'Ada',
      'Lovelace',
      'payroll',
      'pay-ada',
      'tally',
      'acme',
      run,
      startedBy.id,
      startedBy.name,
    ]) {
      expect(sent).not.toContain(named);
    }
  });
});
