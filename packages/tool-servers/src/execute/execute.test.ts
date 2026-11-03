import { Buffer } from 'node:buffer';

import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  controlledSignals,
  describedAccess,
  patientTiming,
  playbookToolCalls,
  recordingCallJournal,
  reportingAccess,
  toolRun,
} from '../testing/index.ts';
import { fakeApiKey, serveFakeApi, serveFakeMcp, type FakeMcpServer } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const aCallId: unknown = expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/u);

const aDuration: unknown = expect.any(Number);

const aTime: unknown = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);

const decodeExecuted = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Struct({ call_id: Schema.String }) }));

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  return fake;
}

function accessTo(fake: FakeMcpServer) {
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' };
  const reporting = reportingAccess({ graph }, { timing: patientTiming, environment: { GRAPH_API_KEY: fakeApiKey } });
  closing.push(reporting.access.close);
  return reporting.access;
}

async function executing() {
  const fake = await fakeServer();
  const access = accessTo(fake);
  const { call, registrations } = playbookToolCalls(access);
  return {
    fake,
    access,
    registrations,
    execute: (input: unknown) => call('execute_connection', input),
    query: (input: unknown) => call('query_connection', input),
  };
}

describe('execute_connection', () => {
  it('is a command of the playbook at POST /tool-servers/{server}/tools/{tool}/execute that may change something outside', async () => {
    const { registrations } = await executing();

    expect(registrations.execute_connection).toMatchObject({
      scope: 'playbook',
      kind: 'command',
      name: 'execute_connection',
      title: 'Execute a connection tool',
      route: { method: 'POST', path: '/tool-servers/{server}/tools/{tool}/execute' },
      pathParameters: ['server', 'tool'],
      reachesOutside: true,
      mayChangeOutside: true,
      readsOnly: false,
      irreversible: false,
      repeatable: false,
      permissions: ['playbook:write'],
      reasons: ['unavailable'],
    });
  });

  it('may change nothing outside on a server with no tool server', () => {
    const { registrations } = playbookToolCalls(reportingAccess({}).access);

    expect(registrations.execute_connection.mayChangeOutside).toBe(false);
  });
});

describe('query_connection', () => {
  it('is a command of the playbook at POST /tool-servers/{server}/tools/{tool}/query that only reads outside', async () => {
    const { registrations } = await executing();

    expect(registrations.query_connection).toMatchObject({
      scope: 'playbook',
      kind: 'command',
      name: 'query_connection',
      title: 'Query a connection tool',
      route: { method: 'POST', path: '/tool-servers/{server}/tools/{tool}/query' },
      pathParameters: ['server', 'tool'],
      reachesOutside: true,
      mayChangeOutside: false,
      readsOnly: true,
      permissions: ['playbook:write'],
      reasons: ['unavailable'],
    });
  });

  it('calls a tool marked reads and answers as execute_connection does', async () => {
    const { fake, query } = await executing();

    expect(await query({ server: 'graph', tool: 'search', arguments: { query: 'acme' } })).toMatchObject({
      status: 'succeeded',
      output: { server: 'graph', tool: 'search', outcome: 'result', text: 'Found 2 rows for acme.' },
    });
    expect(fake.received()).toMatchObject([{ tool: 'search', arguments: { query: 'acme' } }]);
  });

  it('refuses a tool not marked reads, naming execute_connection, and sends nothing', async () => {
    const { fake, query } = await executing();

    expect(await query({ server: 'graph', tool: 'echo', arguments: { said: 'hello' } })).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'tool_not_read_only',
      detail:
        'The echo tool of graph is not marked reads, so query_connection did not call it; execute_connection calls a tool that may change something',
    });
    expect(fake.received()).toEqual([]);
  });
});

describe('a call of a tool its server marks read-only', () => {
  it('calls the tool once and answers what a run of a reasoning function would, with the size, the time and its id', async () => {
    const { fake, execute } = await executing();

    expect(await execute({ server: 'graph', tool: 'search', arguments: { query: 'acme' } })).toEqual({
      status: 'succeeded',
      output: {
        call_id: aCallId,
        server: 'graph',
        tool: 'search',
        outcome: 'result',
        text: 'Found 2 rows for acme.',
        answer: 'Found 2 rows for acme.',
        result_bytes: Buffer.byteLength(
          JSON.stringify({ content: [{ type: 'text', text: 'Found 2 rows for acme.' }] }),
        ),
        duration_ms: aDuration,
        called_at: aTime,
      },
    });
    expect(fake.received()).toMatchObject([{ tool: 'search', arguments: { query: 'acme' } }]);
  });

  it('answers in text exactly what the model of a run that calls the same tool sees', async () => {
    const { access, execute } = await executing();
    const run = await Effect.runPromise(
      access.open(toolRun(recordingCallJournal()), [{ server: 'graph', tool: 'profile' }]),
    );
    closing.push(run.close);

    const seenInARun = await run.offered[0]?.call({ callId: 'call-1', input: {} }, controlledSignals());
    const called = await execute({ server: 'graph', tool: 'profile' });

    expect(called).toMatchObject({ status: 'succeeded', output: { outcome: 'result', text: seenInARun?.text } });
    expect(seenInARun?.text).toBe('{"name":"Ada","rows":2}');
  });
});

describe('the metadata of a call made by hand', () => {
  it('carries the id of the call in the metadata of the call, and no id of a run', async () => {
    const { fake, execute } = await executing();

    const called = await execute({ server: 'graph', tool: 'search', arguments: { query: 'acme' } });

    expect(fake.received()).toEqual([
      {
        tool: 'search',
        arguments: { query: 'acme' },
        meta: { 'auto.on/call_id': decodeExecuted(called).output.call_id },
      },
    ]);
  });
});

describe('a call of a tool its server does not mark read-only', () => {
  it('is made for a caller who may change the playbook, whatever the tool does, with nothing to list first', async () => {
    const { fake, execute } = await executing();
    const kept = JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ said: 'the key [redacted]' }) }] });

    expect(
      await execute({ server: 'graph', tool: 'echo', arguments: { said: `the key ${fakeApiKey}` } }),
    ).toMatchObject({
      status: 'succeeded',
      output: { outcome: 'result', text: '{"said":"the key [redacted]"}', result_bytes: Buffer.byteLength(kept) },
    });
    expect(fake.received()).toMatchObject([{ tool: 'echo' }]);
  });
});

describe('a call of an operation of an HTTP API', () => {
  it('goes through the same call path, answering what the API answered', async () => {
    const fake = await serveFakeApi({ key: fakeApiKey });
    closing.push(fake.close);
    const { access } = await describedAccess(
      { graph: { document: fake.documentUrl, security: { apiKeyAuth: '${GRAPH_API_KEY}' }, org: 'acme' } },
      { environment: { GRAPH_API_KEY: fakeApiKey }, timing: patientTiming },
    );
    closing.push(access.close);

    const called = await playbookToolCalls(access).call('execute_connection', {
      server: 'graph',
      tool: 'echo',
      arguments: { body: { said: 'hello' } },
    });

    expect(called).toMatchObject({ status: 'succeeded', output: { outcome: 'result', answer: { said: 'hello' } } });
    expect(fake.seen()).toMatchObject([{ method: 'POST', path: '/v1/echo' }]);
  });
});
