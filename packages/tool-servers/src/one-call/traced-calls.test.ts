import { recordingTracer, type RecordedSpan } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ToolAccess } from '../access/tool-access.ts';
import { fakeConnections } from '../testing/fake-connections.ts';
import { describedAccess, patientTiming, playbookToolCalls } from '../testing/index.ts';
import { closedAfter, echoCall, oneCallKey, oneCallServer } from '../testing/one-calls.ts';
import { reportingAccess } from '../testing/reporting-access.ts';
import { fakeApiKey, serveFakeApi } from '../testing/served-fakes.ts';

const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

const toolAttributes = {
  'mcp.method.name': 'tools/call',
  'gen_ai.operation.name': 'execute_tool',
  'gen_ai.tool.name': 'echo',
  'auto.on.tool_server': 'graph',
};

const echoedBody = { body: { said: 'hello' } };

function tracedAccess(url: string): ToolAccess {
  const { access } = reportingAccess(
    { graph: { url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', allowed: ['echo'] } },
    { environment: { GRAPH_API_KEY: oneCallKey }, timing: patientTiming, traceMeta: () => ({ traceparent }) },
  );
  closedAfter(access.close);
  return access;
}

async function tracedApiAccess(url: string): Promise<ToolAccess> {
  const { access } = await describedAccess(
    { graph: { document: url, security: { apiKeyAuth: '${GRAPH_API_KEY}' }, org: 'acme' } },
    { environment: { GRAPH_API_KEY: fakeApiKey }, timing: patientTiming, traceMeta: () => ({ traceparent }) },
  );
  closedAfter(access.close);
  return access;
}

async function spansOfOneCall(access: ToolAccess, input = echoCall.input): Promise<readonly RecordedSpan[]> {
  const recording = recordingTracer();
  await Effect.runPromise(Effect.withTracer(access.callOnce({ ...echoCall, input }), recording.tracer));
  return recording.spans();
}

async function spansOfExecute(access: ToolAccess, input: unknown = echoCall.input): Promise<readonly RecordedSpan[]> {
  const recording = recordingTracer();
  const { call } = playbookToolCalls(access);
  await call('execute', { server: 'graph', tool: 'echo', arguments: input }, { tracer: recording.tracer });
  return recording.spans();
}

function toolCallsAmong(spans: readonly RecordedSpan[]): readonly RecordedSpan[] {
  return spans.filter(({ name }) => name === 'tools/call echo');
}

describe('one call of a tool of an MCP server, traced', () => {
  it('is a client span named for the tool, and hands the trace to the server in the metadata of the call', async () => {
    const fake = await oneCallServer();

    expect(await spansOfOneCall(tracedAccess(fake.url))).toMatchObject([
      { name: 'tools/call echo', kind: 'client', ending: 'succeeded', attributes: toolAttributes },
    ]);
    expect(fake.received()).toEqual([
      { tool: 'echo', arguments: echoCall.input, meta: { traceparent, ...echoCall.meta } },
    ]);
  });

  it('names why a call that was never sent ended, and how a sent call that did not answer ended', async () => {
    const fake = await oneCallServer();
    fake.answerNextOf('tools/call', 503);
    const failed = await spansOfOneCall(tracedAccess(fake.url));
    const { url } = fake;
    await fake.close();
    const unopened = await spansOfOneCall(tracedAccess(url));

    expect([...failed, ...unopened].map(({ attributes }) => attributes)).toEqual([
      { ...toolAttributes, 'error.type': 'server_failure' },
      { ...toolAttributes, 'error.type': 'tool_server_failed', 'auto.on.tool_call.because': 'unreachable' },
    ]);
  });
});

describe('a call of a tool of an MCP server made by hand with execute, traced', () => {
  it('is a client span named for the tool beneath the operation, and hands the trace to the server', async () => {
    const fake = await oneCallServer();
    const spans = await spansOfExecute(tracedAccess(fake.url));
    const operation = spans.find(({ name }) => name === 'execute');

    expect(toolCallsAmong(spans)).toMatchObject([
      { kind: 'client', ending: 'succeeded', parentSpanId: operation?.spanId, attributes: toolAttributes },
    ]);
    expect(fake.received()).toMatchObject([{ tool: 'echo', arguments: echoCall.input, meta: { traceparent } }]);
  });

  it('names how a sent call that did not answer ended, and leaves a call refused at its opening to the operation', async () => {
    const fake = await oneCallServer();
    fake.answerNextOf('tools/call', 503);
    const failed = await spansOfExecute(tracedAccess(fake.url));
    const { url } = fake;
    await fake.close();
    const unopened = await spansOfExecute(tracedAccess(url));

    expect(toolCallsAmong(failed).map(({ attributes }) => attributes)).toEqual([
      { ...toolAttributes, 'error.type': 'server_failure' },
    ]);
    expect(unopened.map(({ name, attributes }) => [name, attributes['auto.on.rejection.because']])).toEqual([
      ['execute', 'unreachable'],
    ]);
  });
});

describe('a call of a tool of a connection, traced', () => {
  it('names the connection beside its tool server, called once or by execute', async () => {
    const fake = await oneCallServer();
    const connections = fakeConnections();
    connections.connect('acme', {
      id: 'graph-id',
      name: 'graph',
      entry: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, allowed: ['echo'] },
      environment: { GRAPH_API_KEY: oneCallKey },
    });
    const { access } = reportingAccess({}, { timing: patientTiming, connections });
    closedAfter(access.close);

    const spans = [...(await spansOfOneCall(access)), ...toolCallsAmong(await spansOfExecute(access))];

    expect(spans.map(({ attributes }) => attributes)).toEqual([
      { ...toolAttributes, 'auto.on.connection_id': 'graph-id' },
      { ...toolAttributes, 'auto.on.connection_id': 'graph-id' },
    ]);
  });
});

describe('a call of an operation of an HTTP API', () => {
  it('is no tools/call span, called once or by execute, since its HTTP request is the span beneath', async () => {
    const fake = await serveFakeApi({ key: fakeApiKey });
    closedAfter(fake.close);
    const access = await tracedApiAccess(fake.documentUrl);

    expect(await spansOfOneCall(access, echoedBody)).toEqual([]);
    expect((await spansOfExecute(access, echoedBody)).map(({ name }) => name)).toEqual(['execute']);
    expect(fake.seen()).toMatchObject([
      { method: 'POST', path: '/v1/echo' },
      { method: 'POST', path: '/v1/echo' },
    ]);
  });
});
