import { campaignPace, campaignRows } from '@on.auto/computation/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProgramPoolOf } from '../composition/served-computation.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { patientWorkerPool, scriptedWorkerPool } from '../testing/servers/worker-pools.ts';

const raising = [
  '---',
  'language: typescript',
  '---',
  'export default function (input: any): any {',
  '  const costs = input.rows.map((row: any) => row.cost_cents);',
  '  throw new Error(`no budget for ${costs.length} rows`);',
  '}',
].join('\n');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(Schema.Struct({ type: Schema.String, summary: Schema.String, data: Schema.Unknown })),
  }),
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function serving(programPoolOf: ProgramPoolOf = patientWorkerPool): Promise<ReasoningServer> {
  server = await servingReasoning([], {}, undefined, { programPoolOf });
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/computation`, { body: { name: 'pace', source: campaignPace } });
  await server.call('POST', `${alpha}/definitions/computation`, { body: { name: 'raising', source: raising } });
  return server;
}

function running(name: string, body: object) {
  return server.call('POST', `${alpha}/definitions/computation/${name}/run`, { body });
}

describe('a computation function over HTTP', () => {
  it('runs its program on the input and answers the output, recorded with the work, the time and the sizes', async () => {
    await serving();

    const ran = await running('pace', { input: campaignRows(100), run_id: runId });
    const read = await server.call('GET', `${alpha}/runs/${runId}`);

    expect(ran).toMatchObject({
      status: 200,
      body: {
        type: 'computation',
        name: 'pace',
        status: 'succeeded',
        output: { campaigns: [{ campaign: 'campaign-0' }, {}, {}, {}], total_spend_cents: 283_150 },
      },
    });
    expect(read).toMatchObject({
      status: 200,
      body: { record: { language: 'typescript', input_bytes: JSON.stringify(campaignRows(100)).length } },
    });
    expect(read.body).toHaveProperty('record.work');
    expect(read.body).toHaveProperty('record.duration_ms');
    expect(read.body).toHaveProperty('record.output_bytes');
  });

  it('is listed and read with the definition operations, its schemas and description shown', async () => {
    await serving();

    expect(await server.call('GET', `${alpha}/definitions/computation/pace`)).toMatchObject({
      status: 200,
      body: {
        type: 'computation',
        media_type: 'text/markdown',
        description: 'Spend, pace and projection per campaign, in cents, for a reporting period',
        input_schema: { type: 'object', required: ['rows', 'period'] },
        output_schema: { type: 'object', required: ['campaigns', 'total_spend_cents'] },
      },
    });
  });
});

describe('a run of a computation function that cannot work as written, over HTTP', () => {
  it('ends in conflict, unworkable, with the error and its line, recorded, listed and told with its kind', async () => {
    await serving();
    const detail = 'The program raised an error on line 6: Error: no budget for 2 rows';

    const ran = await running('raising', { input: campaignRows(2), run_id: runId });
    const read = await server.call('GET', `${alpha}/runs/${runId}`);
    const listed = await server.call('GET', `${alpha}/runs?type=computation`);
    const { events } = decodeHistory((await server.call('GET', `${alpha}/runs/${runId}/history`)).body);

    expect(ran).toMatchObject({ status: 409, body: { reason: 'conflict', kind: 'unworkable', detail } });
    expect(read.body).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'conflict', kind: 'unworkable', detail },
    });
    expect(listed.body).toMatchObject({
      runs: [{ run_id: runId, rejection: { reason: 'conflict', kind: 'unworkable' } }],
    });
    expect(events.map(({ type }) => type)).toEqual(['run_started', 'run_rejected']);
    expect(events[1]).toMatchObject({
      summary: 'A run did not go through: it cannot work as it is written.',
      data: { reason: 'conflict', kind: 'unworkable', detail },
    });
    expect(events.every(({ data }) => JSON.stringify(data).length <= 4096)).toBe(true);
  });

  it('runs again under its id, ending the same way, since the same input gives the same result', async () => {
    await serving();

    const first = await running('raising', { input: campaignRows(2), run_id: runId });
    const again = await running('raising', { input: campaignRows(2), run_id: runId });

    expect(again.body).toEqual(first.body);
  });
});

describe('an output too large to record, over HTTP', () => {
  it('ends in conflict for an output larger than a run can record, kept in its sandbox, and the server answers on', async () => {
    await serving();
    const doubled = [
      '---',
      'language: typescript',
      '---',
      'export default function (): Json {',
      "  const text = '\\u0001Ā'.repeat(500_000);",
      '  return [text, text];',
      '}',
    ].join('\n');
    await server.call('POST', `${alpha}/definitions/computation`, { body: { name: 'doubled', source: doubled } });

    expect(await running('doubled', { input: null })).toMatchObject({
      status: 409,
      body: {
        reason: 'conflict',
        kind: 'unworkable',
        detail: "The program's output takes more than the 1048320 bytes as JSON a run can record",
      },
    });
    expect(await running('pace', { input: campaignRows(2) })).toMatchObject({ status: 200 });
  });
});

describe('a long error, over HTTP', () => {
  it('answers, records and lists the text of the error cut at 1,024 bytes', async () => {
    await serving();
    const shouting = [
      '---',
      'language: typescript',
      '---',
      'export default function (): Json {',
      "  throw new Error('x'.repeat(30_000_000));",
      '}',
    ].join('\n');
    await server.call('POST', `${alpha}/definitions/computation`, { body: { name: 'shouting', source: shouting } });
    const detail = `The program raised an error on line 5: Error: ${'x'.repeat(1017)}…`;

    const ran = await running('shouting', { input: null, run_id: runId });
    const read = await server.call('GET', `${alpha}/runs/${runId}`);

    expect(ran).toMatchObject({ status: 409, body: { reason: 'conflict', kind: 'unworkable', detail } });
    expect(read.body).toMatchObject({ rejection: { reason: 'conflict', kind: 'unworkable', detail } });
    expect(JSON.stringify(read.body).length).toBeLessThan(2048);
  });
});

describe('the definitions and inputs of computation functions, over HTTP', () => {
  it('rejects an input the input schema refuses, under /input', async () => {
    await serving();

    expect(await running('pace', { input: { rows: [], period: { days_elapsed: 0, days_total: 30 } } })).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', errors: [{ pointer: '/input/period/days_elapsed' }] },
    });
  });

  it('refuses a definition with each problem and its line, under /source, and a document over 64 KiB', async () => {
    await serving();
    const program = 'export default function (): number {\n  return Math.random();\n}';
    const keyed = ['---', 'language: typescript', 'model: anthropic/claude-sonnet-4-5', '---', program].join('\n');
    const random = ['---', 'language: typescript', '---', program].join('\n');

    expect(
      await server.call('POST', `${alpha}/definitions/computation`, { body: { name: 'keyed', source: keyed } }),
    ).toMatchObject({
      status: 422,
      body: {
        reason: 'invalid_input',
        errors: [
          {
            pointer: '/source',
            detail:
              'Line 3, /model: model is not a key of the front matter; it takes description, language, input, output',
          },
        ],
      },
    });
    expect(
      await server.call('POST', `${alpha}/definitions/computation`, { body: { name: 'random', source: random } }),
    ).toMatchObject({
      status: 422,
      body: {
        reason: 'invalid_input',
        errors: [{ pointer: '/source', detail: "Line 5: Property 'random' does not exist on type 'Math'." }],
      },
    });
    expect(
      await server.call('POST', `${alpha}/definitions/computation`, {
        body: { name: 'large', source: `---\nlanguage: typescript\n---\n${' '.repeat(65_536)}` },
      }),
    ).toMatchObject({ status: 422, body: { reason: 'invalid_input', errors: [{ pointer: '/source' }] } });
  });
});

describe('a run of a computation function the server cannot finish, over HTTP', () => {
  it('is unavailable when no worker is free within its deadline', async () => {
    await serving(scriptedWorkerPool({ ran: 'stopped', because: 'busy', milliseconds: 10_000 }));

    expect(await running('pace', { input: campaignRows(2) })).toMatchObject({
      status: 503,
      body: {
        reason: 'unavailable',
        detail: 'No worker was free to run it within 10000 ms; this server runs 4 computation functions at once',
      },
    });
  });

  it('fails with an incident when its worker crashes, and the run is recorded as failed', async () => {
    await serving(
      scriptedWorkerPool({
        ran: 'crashed',
        detail: 'The worker ended with code 1 before it answered',
        milliseconds: 5,
      }),
    );

    const ran = await running('pace', { input: campaignRows(2), run_id: runId });

    expect(ran).toMatchObject({ status: 500 });
    expect(await server.call('GET', `${alpha}/runs/${runId}`)).toMatchObject({
      body: { status: 'failed' },
    });
  });
});
