import { Buffer } from 'node:buffer';

import { computationBounds } from '@on.auto/computation';
import { campaignPace, campaignRows } from '@on.auto/computation/testing';
import { checkingWithin } from '@on.auto/definitions/testing';
import { callDocument } from '@on.auto/interaction/testing';
import { lookupDocument } from '@on.auto/lookup/testing';
import { type FakeTool, serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { programPool } from '@on.auto/workflow-engine/dsl';
import { moduleOfSource } from '@on.auto/workflow-engine/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import type { ProgramPoolOf } from '../composition/served-computation.ts';
import { alpha, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { blocksInOrderOf } from '../testing/servers/tutorial-calls.ts';
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

const decodeKeptMembers = Schema.decodeUnknownSync(
  Schema.Struct({
    output: Schema.Tuple([
      Schema.Struct({ id: Schema.String, sha256: Schema.String }),
      Schema.Struct({ id: Schema.String, sha256: Schema.String }),
      Schema.Unknown,
    ]),
  }),
);

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(Schema.Struct({ type: Schema.String, summary: Schema.String, data: Schema.Unknown })),
  }),
);

let server: ReasoningServer;

function savedComputation(name: string, source: string) {
  return server.call('POST', `${alpha}/definitions/computation`, { body: { name, source, diagram: 'none' } });
}

async function serving(programPoolOf: ProgramPoolOf = patientWorkerPool): Promise<ReasoningServer> {
  server = await servingReasoning([], {}, undefined, { programPoolOf });
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await savedComputation('pace', campaignPace);
  await savedComputation('raising', raising);
  return server;
}

function running(name: string, body: object) {
  return server.call('POST', `${alpha}/definitions/computation/${name}/run`, { body });
}

const blockingOnTwoRows = moduleOfSource(
  [
    "import { parentPort, threadId } from 'node:worker_threads';",
    'let jobs = 0;',
    "parentPort.on('message', ({ job, request }) => {",
    '  jobs += 1;',
    '  if (JSON.parse(request.arguments[0]).rows.length === 2) { while (true) {} }',
    '  const output = JSON.stringify({ jobs, thread: threadId });',
    "  parentPort.postMessage({ job, answer: { ran: 'answered', output, bytes: output.length, work: 0 }, keep: true });",
    '});',
  ].join('\n'),
);

const decodeRan = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ jobs: Schema.Number, thread: Schema.Number }) }),
);

const timerSlackMs = 2;

function ran(rows: number) {
  return server.call('POST', `${alpha}/definitions/computation/pace/run`, { body: { input: campaignRows(rows) } });
}

async function ranOn(rows: number) {
  return decodeRan((await ran(rows)).body).output;
}

const [pace, input, output, readCosts, writeSummary, report] = blocksInOrderOf('reference/computation-format.md').map(
  ({ body }) => body,
);

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

function saved(type: string, name: string, source: string | undefined) {
  return server.call('POST', `${alpha}/definitions/${type}`, {
    body: { name, source, ...(type === 'workflow' ? {} : { diagram: 'none' }) },
  });
}

const campaignCosts: FakeTool = {
  name: 'campaign-costs',
  description: 'Reads the cost rows of every campaign for a month.',
  inputSchema: { type: 'object', properties: { month: { type: 'string' } }, required: ['month'] },
  annotations: { readOnlyHint: true },
  answer: () => ({ content: [], structuredContent: { rows: [] } }),
};

async function servingTheAdsServer(): Promise<ReasoningServer> {
  const ads = await serveFakeMcp({ tools: [campaignCosts] });
  onTestFinished(ads.close);
  return servingReasoning([], { TOOL_SERVERS: JSON.stringify({ ads: { url: ads.url, org: 'acme' } }) });
}

async function servingTheFilesServer(page: string, received: (content: unknown) => void): Promise<ReasoningServer> {
  const readPage: FakeTool = {
    name: 'read-page',
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true },
    answer: () => ({ content: [{ type: 'text', text: page }] }),
  };
  const savePage: FakeTool = {
    name: 'save-page',
    inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
    answer: (given) => {
      received(Reflect.get(new Object(given), 'content'));
      return { content: [{ type: 'text', text: 'Saved.' }] };
    },
  };
  const files = await serveFakeMcp({ tools: [readPage, savePage], mostRequestBytes: 16 * 1_048_576 });
  onTestFinished(files.close);
  return servingReasoning([], { TOOL_SERVERS: JSON.stringify({ files: { url: files.url, org: 'acme' } }) });
}

const anyObject = ['input:', '  schema: { type: object }'];

const readingThePage = lookupDocument({
  server: 'files',
  tool: 'read-page',
  read: null,
  with: [],
  input: anyObject,
  output: ['output:', '  schema: { type: string }'],
});

const savingThePage = callDocument({
  server: 'files',
  tool: 'save-page',
  read: null,
  with: ["    content: '{{ input.page }}'"],
  input: anyObject,
  output: ['output:', '  schema: {}'],
});

const measuringThePage = [
  '---',
  'language: typescript',
  '---',
  'export default function (input: any): Json {',
  '  const page: string = input.page;',
  "  const same = page === 'a'.repeat(1100000) + '\\uFFFD';",
  '  return { length: page.length, last: page.charCodeAt(page.length - 1), same };',
  '}',
].join('\n');

const decodeKeptPage = Schema.decodeUnknownSync(
  Schema.Struct({
    output: Schema.Struct({
      id: Schema.String,
      media_type: Schema.String,
      bytes: Schema.Number,
      sha256: Schema.String,
      address: Schema.NullOr(Schema.String),
      address_until: Schema.NullOr(Schema.String),
    }),
  }),
);

describe('computation over http', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('a computation function over HTTP', () => {
    it('runs its program on the input and answers the output, recorded with the work, the time and the sizes', async () => {
      await serving();

      const ranComputation = await running('pace', { input: campaignRows(100), run_id: runId });
      const read = await server.call('GET', `${alpha}/runs/${runId}`);

      expect(ranComputation).toMatchObject({
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

      const ranComputation = await running('raising', { input: campaignRows(2), run_id: runId });
      const read = await server.call('GET', `${alpha}/runs/${runId}`);
      const listed = await server.call('GET', `${alpha}/runs?type=computation`);
      const { events } = decodeHistory((await server.call('GET', `${alpha}/runs/${runId}/history`)).body);

      expect(ranComputation).toMatchObject({ status: 409, body: { reason: 'conflict', kind: 'unworkable', detail } });
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
    it('keeps the largest members of an output larger than a run can record as files of the playbook, which it reads as any asset, and the server answers on', async () => {
      await serving();
      const doubled = [
        '---',
        'language: typescript',
        '---',
        'export default function (): Json {',
        "  const text = '\\u0001Ā'.repeat(500_000);",
        '  return [text, text, { rows: 2 }];',
        '}',
      ].join('\n');
      await savedComputation('doubled', doubled);
      const kept = { media_type: 'text/plain; charset=utf-8', bytes: 1_500_000, address: null, address_until: null };

      const ranComputation = await running('doubled', { input: null, run_id: runId });
      const [first, second] = decodeKeptMembers(ranComputation.body).output;

      expect(ranComputation).toMatchObject({
        status: 200,
        body: { status: 'succeeded', output: [kept, kept, { rows: 2 }] },
      });
      expect(second.sha256).toBe(first.sha256);
      expect(await server.call('GET', `${alpha}/assets/${first.id}`)).toMatchObject({
        status: 200,
        body: { media_type: kept.media_type, bytes: kept.bytes, expired: false },
      });
      expect(await running('pace', { input: campaignRows(2) })).toMatchObject({ status: 200 });
    });

    it('keeps a text with a lone surrogate as text made well formed, which a string argument of a tool takes as that text and a computation reads as it', async () => {
      const cut = `${'a'.repeat(1_100_000)}\uD83D`;
      const wellFormed = cut.toWellFormed();
      const sent: unknown[] = [];
      server = await servingTheFilesServer(cut, (content) => {
        sent.push(content);
      });
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      await saved('lookup', 'read-the-page', readingThePage);
      await saved('interaction', 'save-the-page', savingThePage);
      await savedComputation('measure-the-page', measuringThePage);

      const read = await server.call('POST', `${alpha}/definitions/lookup/read-the-page/run`, { body: { input: {} } });
      const page = decodeKeptPage(read.body).output;
      const saving = await server.call('POST', `${alpha}/definitions/interaction/save-the-page/run`, {
        body: { input: { page } },
      });
      const measured = await running('measure-the-page', { input: { page } });

      expect(page).toMatchObject({ media_type: 'text/plain; charset=utf-8', bytes: Buffer.byteLength(cut, 'utf8') });
      expect(page.bytes).toBe(Buffer.byteLength(wellFormed, 'utf8'));
      expect(saving).toMatchObject({ status: 200, body: { status: 'succeeded' } });
      expect(sent.map((content) => content === wellFormed)).toEqual([true]);
      expect(measured).toMatchObject({
        status: 200,
        body: { output: { length: wellFormed.length, last: 0xff_fd, same: true } },
      });
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
      await savedComputation('shouting', shouting);
      const detail = `The program raised an error on line 5: Error: ${'x'.repeat(1017)}…`;

      const ranComputation = await running('shouting', { input: null, run_id: runId });
      const read = await server.call('GET', `${alpha}/runs/${runId}`);

      expect(ranComputation).toMatchObject({ status: 409, body: { reason: 'conflict', kind: 'unworkable', detail } });
      expect(read.body).toMatchObject({ rejection: { reason: 'conflict', kind: 'unworkable', detail } });
      expect(JSON.stringify(read.body).length).toBeLessThan(2048);
    });
  });

  describe('the definitions and inputs of computation functions, over HTTP', () => {
    it('rejects an input the input schema refuses, under /input', async () => {
      await serving();

      expect(await running('pace', { input: { rows: [], period: { days_elapsed: 0, days_total: 30 } } })).toMatchObject(
        {
          status: 422,
          body: { reason: 'invalid_input', errors: [{ pointer: '/input/period/days_elapsed' }] },
        },
      );
    });

    it('refuses a definition with each problem and its line, under /source, and a document over 64 KiB', async () => {
      await serving();
      const program = 'export default function (): number {\n  return Math.random();\n}';
      const keyed = ['---', 'language: typescript', 'model: anthropic/claude-sonnet-4-5', '---', program].join('\n');
      const random = ['---', 'language: typescript', '---', program].join('\n');

      expect(await savedComputation('keyed', keyed)).toMatchObject({
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
      expect(await savedComputation('random', random)).toMatchObject({
        status: 422,
        body: {
          reason: 'invalid_input',
          errors: [{ pointer: '/source', detail: "Line 5: Property 'random' does not exist on type 'Math'." }],
        },
      });
      expect(
        await server.call('POST', `${alpha}/definitions/computation`, {
          body: { name: 'large', source: `---\nlanguage: typescript\n---\n${' '.repeat(65_536)}`, diagram: 'none' },
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

      const ranComputation = await running('pace', { input: campaignRows(2), run_id: runId });

      expect(ranComputation).toMatchObject({ status: 500 });
      expect(await server.call('GET', `${alpha}/runs/${runId}`)).toMatchObject({
        body: { status: 'failed' },
      });
    });
  });
});

describe('computation deadline', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('a run of a computation function that does not end by itself, over HTTP', () => {
    it('is unavailable once its warm worker is terminated at the deadline, while another worker answers and the server answers other requests', async () => {
      server = await servingReasoning([], {}, undefined, {
        programPoolOf: ({ workers }, handed) =>
          checkingWithin(
            programPool({
              workers,
              heapMegabytes: computationBounds.heapMegabytes,
              worker: blockingOnTwoRows,
              handed,
              instances: 'fresh',
            }),
          ),
      });
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      await server.call('POST', `${alpha}/definitions/computation`, {
        body: { name: 'pace', source: campaignPace, diagram: 'none' },
      });
      const warm = await ranOn(3);
      const started = performance.now();
      const settled = { run: false };

      const runningComputationDeadline = ran(2).then((response) => {
        settled.run = true;
        return { response, milliseconds: performance.now() - started };
      });
      const meanwhile = await server.call('GET', `${alpha}/definitions/computation/pace`);
      const elsewhere = await ranOn(3);
      const answeredFirst = !settled.run;
      const { response, milliseconds } = await runningComputationDeadline;
      const after = await ranOn(3);

      expect(meanwhile).toMatchObject({ status: 200, body: { name: 'pace' } });
      expect([answeredFirst, elsewhere.jobs]).toEqual([true, 1]);
      expect(elsewhere.thread).not.toBe(warm.thread);
      expect(response).toMatchObject({
        status: 503,
        body: {
          reason: 'unavailable',
          detail: 'The run took longer than the 10000 ms a computation function may run, and was stopped',
        },
      });
      expect(milliseconds).toBeGreaterThanOrEqual(computationBounds.deadlineMs - timerSlackMs);
      expect(after).toEqual({ jobs: 2, thread: elsewhere.thread });
    });
  });
});

describe('documented example', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('the example of the computation function format, through the server', () => {
    it('saves the function and answers the output the page shows for its input, after the work it says', async () => {
      server = await servingReasoning([]);
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

      const created = await saved('computation', 'campaign-pace', pace);
      const ranDocumentedExample = await server.call('POST', `${alpha}/definitions/computation/campaign-pace/run`, {
        body: { input: decodeJson(input), run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
      });
      const read = await server.call('GET', `${alpha}/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a`);

      expect(created.status).toBe(201);
      expect(ranDocumentedExample.body).toMatchObject({ status: 'succeeded', output: decodeJson(output) });
      expect(read.body).toMatchObject({ record: { language: 'typescript', work: 0 } });
    });

    it('saves the workflow of the page and the functions it calls, the reading one a lookup function of a tool marked reads, every expression checked', async () => {
      server = await servingTheAdsServer();
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

      const created = [
        await saved('computation', 'campaign-pace', pace),
        await saved('lookup', 'read-campaign-costs', readCosts),
        await saved('reasoning', 'write-pace-summary', writeSummary),
        await saved('workflow', 'campaign-pace-report', report),
      ];

      expect(created.map(({ status }) => status)).toEqual([201, 201, 201, 201]);
    });
  });
});
