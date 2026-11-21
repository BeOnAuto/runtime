import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { answeringFromTheTools, textResult } from '@on.auto/reasoning/testing';
import { type FakeMcpServer, serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { servingWorkflows, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const builder = createApiKey({ id: 'acme-builder', org: 'acme', permissions: allPermissions, playbooks: '*' });

const reader = createApiKey({
  id: 'acme-reader',
  org: 'acme',
  permissions: ['org:read', 'playbook:read'],
  playbooks: '*',
});

const closing: (() => Promise<void>)[] = [];

interface Serving {
  readonly server: ReasoningServer;
  readonly graph: FakeMcpServer;
}

async function serving(over?: 'http'): Promise<Serving> {
  const graph = await serveFakeMcp({ bearer: apiKey });
  closing.push(graph.close);
  const server = await servingReasoning(
    [],
    {
      API_KEYS: JSON.stringify([builder.entry, reader.entry]),
      GRAPH_API_KEY: apiKey,
      TOOL_SERVERS: JSON.stringify({
        graph: {
          url: graph.url,
          headers: { Authorization: 'Bearer ${GRAPH_API_KEY}', 'X-Region': 'production-eu' },
          org: 'acme',
        },
      }),
    },
    undefined,
    over === undefined ? {} : { over },
  );
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', {
    key: builder.key,
    body: { playbook: 'alpha', name: 'Alpha' },
  });
  return { server, graph };
}

function executeOf(server: ReasoningServer, tool: string, body: unknown = {}, key = builder.key) {
  return server.call('POST', `${alpha}/tool-servers/graph/tools/${tool}/execute`, { key, body });
}

const decodeRun = Schema.decodeUnknownSync(Schema.Struct({ run_id: Schema.String }));

const decodeEvents = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

const aCallId: unknown = expect.stringMatching(/^[0-9a-f-]{36}$/u);

const aNumber: unknown = expect.any(Number);

const answeringWhatItSaw = answeringFromTheTools([['graph__profile', {}]], (texts) => textResult(texts.join('')));

const profiling = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/profile]', '---', 'Profile acme.'].join(
  '\n',
);

const onACall = workflowSource(
  'on-a-call',
  'schedule:\n  on: { one: { with: { type: tool_call_started } } }\ndo:\n  - seen: { set: { seen: true } }\n',
);

const pageOfWhatItSees = [
  'page:',
  '  data:',
  '    language: typescript',
  '    source:',
  '      events:',
  '        - type: tool_call_started',
  '        - type: tool_call_answered',
  '        - type: com.acme.ledger.closed',
  '    views:',
  '      seen: categories',
  '    module: |',
  '      export function fold(view: View, event: Event): View {',
  '        return { seen: { values: [...(view.seen?.values ?? []), { name: event.type, value: 1 }] } };',
  '      }',
  '  result: Seen.',
  "  runs: '{% for value in views.seen.values %}{{ value.name }}{% endfor %}'",
  '',
].join('\n');

const onAClosing = workflowSource(
  'on-a-closing',
  `schedule:\n  on: { one: { with: { type: com.acme.ledger.closed } } }\ndo:\n  - seen: { set: { seen: true } }\n${pageOfWhatItSees}`,
);

const RunsSchema = Schema.Struct({ runs: Schema.Array(Schema.Struct({ status: Schema.String })) });

const decodeRuns = Schema.decodeUnknownSync(RunsSchema);

interface CalledPlaybook {
  readonly server: ReasoningServer;
  readonly saved: readonly number[];
}

async function servingACalledPlaybook(): Promise<CalledPlaybook> {
  const graph = await serveFakeMcp({ bearer: apiKey });
  closing.push(graph.close);
  const server = await servingWorkflows([], {
    GRAPH_API_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({
      graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
    }),
  });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const saving = [
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'on-a-call', source: onACall } }),
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'on-a-closing', source: onAClosing } }),
  ];
  return { server, saved: saving.map(({ status }) => status) };
}

async function runsOf(server: ReasoningServer, name: string) {
  const { body } = await server.call('GET', `${alpha}/runs?type=workflow&name=${name}`);
  return decodeRuns(body).runs;
}

describe('hand calls over http', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('execute over HTTP', () => {
    it('calls a tool, whether its server marks it read-only or not, answering what a run’s model would see', async () => {
      const { server, graph } = await serving();

      const read = await executeOf(server, 'search', { arguments: { query: 'acme' } });
      const written = await executeOf(server, 'echo', { arguments: { said: 'hello' } });

      expect(read).toMatchObject({
        status: 200,
        body: {
          call_id: aCallId,
          server: 'graph',
          tool: 'search',
          outcome: 'result',
          text: 'Found 2 rows for acme.',
          result_bytes: aNumber,
          duration_ms: aNumber,
        },
      });
      expect(written).toMatchObject({ status: 200, body: { outcome: 'result', text: '{"said":"hello"}' } });
      expect(read.headers.get('cache-control')).toBe('no-store');
      expect(graph.received()).toMatchObject([{ tool: 'search' }, { tool: 'echo' }]);
    });

    it('answers a server that cannot be used as a problem retried later, and a tool it is not offered as one that is not', async () => {
      const { server, graph } = await serving();

      graph.answerNextWith(503);
      const failing = await executeOf(server, 'search', { arguments: { query: 'acme' } });
      const unlisted = await executeOf(server, 'lookup');

      expect(failing).toMatchObject({
        status: 503,
        body: { reason: 'unavailable', kind: 'tool_server_failed', because: 'failing' },
      });
      expect(failing.headers.get('retry-after')).toBe('5');
      expect(unlisted).toMatchObject({
        status: 503,
        body: { reason: 'unavailable', kind: 'tool_not_offered', because: 'tool_not_listed' },
      });
      expect(unlisted.headers.get('retry-after')).toBeNull();
      expect(graph.received()).toEqual([]);
    });
  });

  describe('who may execute a tool over HTTP, and what the answer leaves out', () => {
    it('refuses a key that may only read, even for a tool that only reads, and a retired playbook, and shows no secret', async () => {
      const { server, graph } = await serving();

      const read = await executeOf(server, 'search', { arguments: { query: 'acme' } }, reader.key);
      const called = await executeOf(server, 'search', { arguments: { query: 'acme' } });
      await server.call('POST', `${alpha}/retire`, { key: builder.key });
      const retired = await executeOf(server, 'search', { arguments: { query: 'acme' } });
      const events = await server.call('GET', `${alpha}/events?order=asc`, { key: builder.key });
      const text = JSON.stringify([called.body, events.body]);

      expect(read).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
      expect(retired).toMatchObject({ status: 409, body: { reason: 'conflict', kind: 'retired' } });
      expect(graph.received()).toHaveLength(1);
      expect([apiKey, 'production-eu', 'Bearer', graph.url].filter((secret) => text.includes(secret))).toEqual([]);
    });
  });

  describe('what a call made by hand records in the history of the playbook', () => {
    it('shows a start and an answer in the events of the playbook, by type, beside the calls of runs, and in the history of no run', async () => {
      const { server } = await serving();

      await executeOf(server, 'search', { arguments: { query: 'acme' } });
      const events = await server.call('GET', `${alpha}/events?order=asc`, { key: builder.key });
      const starts = await server.call('GET', `${alpha}/events?type=tool_call_started`, { key: builder.key });
      const answers = await server.call('GET', `${alpha}/events?type=tool_call_answered`, { key: builder.key });
      const runs = await server.call('GET', `${alpha}/runs`, { key: builder.key });

      expect(events.body).toMatchObject({
        events: [
          {
            type: 'tool_call_started',
            summary: 'Someone allowed to change the playbook called the search tool of graph by hand.',
            data: { server: 'graph', tool: 'search', arguments: { query: 'acme' } },
            metadata: { causation_id: null, by: 'acme-builder' },
          },
          {
            type: 'tool_call_answered',
            summary: 'The tool answered.',
            data: { is_error: false, answer: 'Found 2 rows for acme.' },
          },
        ],
      });
      expect([starts.body, answers.body]).toMatchObject([
        { events: [{ type: 'tool_call_started' }] },
        { events: [{ type: 'tool_call_answered' }] },
      ]);
      expect(runs.body).toMatchObject({ runs: [] });
    });
  });

  describe('what a call made by hand does not record', () => {
    it('is in the history of no run, which shows only what the run recorded', async () => {
      const { server } = await serving();
      const echo = [
        '---',
        'language: typescript',
        '---',
        'export default function (input: Input): Output {',
        '  return input;',
        '}',
      ].join('\n');
      await server.call('POST', `${alpha}/definitions/computation`, {
        key: builder.key,
        body: { name: 'echo', source: echo, diagram: 'none' },
      });

      const ran = await server.call('POST', `${alpha}/definitions/computation/echo/run`, {
        key: builder.key,
        body: { input: { said: 'hello' } },
      });
      await executeOf(server, 'search', { arguments: { query: 'acme' } });
      const history = await server.call('GET', `${alpha}/runs/${decodeRun(ran.body).run_id}/history`, {
        key: builder.key,
      });

      expect(decodeEvents(history.body).events.map(({ type }) => type)).toEqual(['run_started', 'run_succeeded']);
    });
  });

  describe('a call made by hand whose caller goes away over HTTP while the tool is called', () => {
    it('records a start and no answer, sends no second call, and still lets the session go', async () => {
      const { server, graph } = await serving('http');
      const leaving = new AbortController();

      const gone: Promise<unknown> = fetch(`${server.origin}${alpha}/tool-servers/graph/tools/sleep/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${builder.key}` },
        body: JSON.stringify({ arguments: { ms: 5000 } }),
        signal: leaving.signal,
      }).catch((error: unknown) => error);
      await until(
        () => graph.received().length,
        (received) => received === 1,
      );
      leaving.abort();

      expect(await gone).toMatchObject({ name: 'AbortError' });
      expect(
        await until(
          () => graph.endedSessions(),
          (ended) => ended === 1,
        ),
      ).toBe(1);
      const events = await server.call('GET', `${alpha}/events?order=asc`, { key: builder.key });
      expect(events.body).toMatchObject({ events: [{ type: 'tool_call_started' }] });
      expect(graph.received()).toHaveLength(1);
    });
  });
});

describe('hand calls against runs', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('what a call made by hand answers', () => {
    it('is the text the model of a run of a function that names the same tool sees of its answer', async () => {
      const graph = await serveFakeMcp({ bearer: apiKey });
      closing.push(graph.close);
      const server = await servingReasoning([answeringWhatItSaw], {
        GRAPH_API_KEY: apiKey,
        TOOL_SERVERS: JSON.stringify({
          graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
        }),
      });
      closing.push(server.stop);
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      await server.call('POST', `${alpha}/definitions/reasoning`, {
        body: { name: 'profile', source: profiling, diagram: 'none' },
      });

      const ran = await server.call('POST', `${alpha}/definitions/reasoning/profile/run`, { body: { input: {} } });
      const called = await server.call('POST', `${alpha}/tool-servers/graph/tools/profile/execute`, { body: {} });

      expect(ran).toMatchObject({ status: 200, body: { status: 'succeeded', output: '{"name":"Ada","rows":2}' } });
      expect(called).toMatchObject({ status: 200, body: { outcome: 'result', text: '{"name":"Ada","rows":2}' } });
      expect(graph.received().map(({ tool }) => tool)).toEqual(['profile', 'profile']);
    });
  });
});

describe('hand calls unseen', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('the calls made by hand in a playbook', () => {
    it('reach no page and start no workflow, while the events after them do', async () => {
      const { server, saved } = await servingACalledPlaybook();

      const called = await server.call('POST', `${alpha}/tool-servers/graph/tools/search/execute`, {
        body: { arguments: { query: 'acme' } },
      });
      await server.call('POST', `${alpha}/events`, {
        body: { event: { source: '/ledger', type: 'com.acme.ledger.closed', data: { month: 'october' } } },
      });
      const triggered = await until(async () => {
        const runs = await runsOf(server, 'on-a-closing');
        expect(runs).toMatchObject([{ status: 'succeeded' }]);
        return runs;
      });
      const presented = await until(async () => {
        const read = await server.call('GET', `${alpha}/definitions/workflow/on-a-closing`);
        expect(read.body).toMatchObject({ page: { standing: { state: 'live', folded: 1 } } });
        return read;
      });

      expect(saved).toEqual([201, 201]);
      expect(called).toMatchObject({ status: 200, body: { outcome: 'result' } });
      expect(triggered).toHaveLength(1);
      expect(await runsOf(server, 'on-a-call')).toEqual([]);
      expect(presented.body).toMatchObject({ page: { runs: 'com.acme.ledger.closed' } });
      expect(await runsOf(server, 'on-a-call')).toEqual([]);
    });
  });
});
