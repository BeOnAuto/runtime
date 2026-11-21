import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  calling,
  lookingUp,
  problemWith,
  systemRunId,
  type SystemServer,
} from '../testing/interaction-servers/system-calls.ts';
import { alpha, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { blocksInOrderOf } from '../testing/servers/tutorial-calls.ts';
import { runIdIn, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const withinItsCall =
  'The run takes place within the call that started it, which no server can interrupt from outside, so it cannot be cancelled; it ends when that call does';

const callFacts = ['run_started', 'tool_call_started', 'tool_call_answered', 'run_succeeded'];

async function sleeping(): Promise<SystemServer> {
  const serverRuns = await lookingUp({ over: 'http' });
  await serverRuns.define('sleeping', calling('sleep', ['    ms: 1000']));
  return serverRuns;
}

async function leftOnceCalled(serverRuns: SystemServer, url: string, body: string): Promise<unknown> {
  const leaving = new AbortController();
  const gone: Promise<unknown> = fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: leaving.signal,
  }).catch((error: unknown) => error);
  await until(
    () => Promise.resolve(serverRuns.fake.received().length),
    (received) => received === 1,
  );
  leaving.abort();
  return gone;
}

const [pace = '', paceInput = ''] = blocksInOrderOf('reference/computation-format.md').map(({ body }) => body);

const [, history = '', historyInput = '', historyAnswer = ''] = blocksInOrderOf('reference/lookup-format.md').map(
  ({ body }) => body,
);

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

const RowSchema = Schema.Struct({ campaign: Schema.String, cost_cents: Schema.Int, budget_cents: Schema.Int });

const decodePaceInput = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ rows: Schema.Array(RowSchema), period: Schema.Json })),
);

const decodeAnswer = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ runs: Schema.Tuple([Schema.Struct({ run_id: Schema.String, output: Schema.Json })]) }),
  ),
);

const aMoment: unknown = expect.any(String);

let server: ReasoningServer;

function saved(type: string, name: string, source: string) {
  return server.call('POST', `${alpha}/definitions/${type}`, { body: { name, source, diagram: 'none' } });
}

function paced(input: Schema.Json, runId: string) {
  return server.call('POST', `${alpha}/definitions/computation/campaign-pace/run`, {
    body: { input, run_id: runId },
  });
}

const RunsAnswer = Schema.Struct({
  output: Schema.Struct({ runs: Schema.Array(Schema.Struct({ run_id: Schema.String })) }),
});

const runsAnswered = Schema.decodeUnknownSync(RunsAnswer);

function pacingWith(input: Schema.Json): string {
  return workflowSource(
    'pacing',
    [
      'do:',
      `  - pace: { call: run_definition, with: { type: computation, name: campaign-pace, input: ${JSON.stringify(input)} } }`,
      'page:',
      '  data:',
      '    language: typescript',
      '    source:',
      '      events:',
      '        - type: run_succeeded',
      '          subject: computation/campaign-pace',
      '    views:',
      '      paced: series',
      '    module: |',
      '      export function fold(view: View, event: Event): View {',
      '        return view;',
      '      }',
      '  runs: |',
      '    {{ views.paced | json }}',
      '',
    ].join('\n'),
  );
}

async function ranPacing(): Promise<unknown> {
  const started = await server.call('POST', `${alpha}/definitions/workflow/pacing/run`, { body: { input: {} } });
  return (await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`)).body;
}

describe('a run of a lookup function whose session is gone', () => {
  it('opens a session its server forgot once more, and answers', async () => {
    const serverRuns = await lookingUp();
    await serverRuns.define('asking');
    serverRuns.fake.answerNextOf('tools/call', 404);

    expect(await serverRuns.runCall('asking')).toMatchObject({ status: 200, body: { status: 'succeeded' } });
  });
});

describe('a run of a lookup function while its call is in flight, over HTTP', () => {
  it('goes on to its end when its caller goes away, records the answer, and cannot be cancelled meanwhile', async () => {
    const serverRuns = await sleeping();
    await leftOnceCalled(
      serverRuns,
      `${serverRuns.origin}${alpha}/definitions/lookup/sleeping/run`,
      JSON.stringify({ input: {}, run_id: systemRunId }),
    );

    const cancelling = await serverRuns.call('POST', `${alpha}/runs/${systemRunId}/cancel`, {
      body: { reason: 'Stop' },
    });
    const ended = await settledRun(serverRuns, `${alpha}/runs/${systemRunId}`);

    expect([cancelling.status, cancelling.body]).toEqual([409, problemWith({ detail: withinItsCall })]);
    expect(ended.body).toMatchObject({ status: 'succeeded', output: 'Slept.' });
    expect((await serverRuns.history(systemRunId)).map(({ type }) => type)).toEqual(callFacts);
  });
});

describe('reading runs', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('the example of a lookup function that reads runs, through the server', () => {
    it('answers the runs of the computation function the page names, which then names the lookup among its users', async () => {
      server = await servingReasoning([]);
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      const {
        runs: [shown],
      } = decodeAnswer(historyAnswer);
      const { rows, period } = decodePaceInput(paceInput);
      const springSaleAlone = { rows: rows.filter(({ campaign }) => campaign === 'spring-sale'), period };

      const created = [
        await saved('computation', 'campaign-pace', pace),
        await saved('lookup', 'pace-history', history),
      ];
      await paced(decodeJson(paceInput), shown.run_id);
      await paced(springSaleAlone, '019a2a1e-ae00-7c1a-9b3f-2f1e0d9c8b7a');
      const ran = await server.call('POST', `${alpha}/definitions/lookup/pace-history/run`, {
        body: { input: decodeJson(historyInput), run_id: '019a2f44-0a00-7c1a-9b3f-2f1e0d9c8b7a' },
      });
      const read = await server.call('GET', `${alpha}/runs/019a2f44-0a00-7c1a-9b3f-2f1e0d9c8b7a`);
      const used = await server.call('GET', `${alpha}/definitions/computation/campaign-pace`);

      expect(created.map(({ status }) => status)).toEqual([201, 201]);
      expect(ran.body).toMatchObject({
        status: 'succeeded',
        output: { runs: [{ run_id: shown.run_id, definition_version: 1, output: shown.output }], more: false },
      });
      expect(read.body).toMatchObject({ record: { examined: 2, through: aMoment } });
      expect(used.body).toMatchObject({ used_by: [{ type: 'lookup', name: 'pace-history', relation: 'reads' }] });
    });
  });
});
describe('the runs of a function renamed with new_name, through the server', () => {
  afterEach(async () => {
    await server.stop();
  });

  it('are still called by the workflow and read by the lookup that use it, each saved again with the new name, and counted by its own page', async () => {
    server = await servingReasoning([]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await saved('computation', 'campaign-pace', pace);
    await saved('lookup', 'pace-history', history);
    await server.call('POST', `${alpha}/definitions/workflow`, {
      body: { name: 'pacing', source: pacingWith(decodeJson(paceInput)) },
    });
    const before = await ranPacing();

    const renamed = await server.call('PUT', `${alpha}/definitions/computation/campaign-pace`, {
      body: { new_name: 'spend-pace' },
    });
    const after = await ranPacing();
    const read = await server.call('POST', `${alpha}/definitions/lookup/pace-history/run`, {
      body: { input: decodeJson(historyInput) },
    });
    const [pacing, reading] = [
      await server.call('GET', `${alpha}/definitions/workflow/pacing`),
      await server.call('GET', `${alpha}/definitions/lookup/pace-history`),
    ];
    const ownPage = await until(async () => {
      const { body } = await server.call('GET', `${alpha}/definitions/computation/spend-pace`);
      expect(body).toMatchObject({ page: { standing: { state: 'live', version: 2, folded: 2 } } });
      return body;
    });

    expect(renamed).toMatchObject({
      status: 200,
      body: {
        type: 'computation',
        name: 'spend-pace',
        version: 2,
        used_by: [{ name: 'pace-history' }, { name: 'pacing' }],
      },
    });
    expect([before, after]).toMatchObject([{ status: 'succeeded' }, { status: 'succeeded' }]);
    expect(runsAnswered(read.body).output.runs).toHaveLength(2);
    expect([pacing.body, reading.body]).toMatchObject([
      { version: 2, source: pacingWith(decodeJson(paceInput)).replaceAll('campaign-pace', 'spend-pace') },
      { version: 2, source: history.replace('campaign-pace', 'spend-pace') },
    ]);
    expect(ownPage).toMatchObject({ version: 2, source: pace.replace('campaign-pace', 'spend-pace') });
  });
});
