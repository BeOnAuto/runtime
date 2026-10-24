import { callDocument } from '@on.auto/interaction/testing';
import { fakeStdioServerPath } from '@on.auto/tool-servers/testing';
import { describe, expect, it } from 'vitest';

import { interactionServerOn } from '../testing/interaction-servers/interaction-server.ts';
import {
  askingASystem,
  calling,
  problemWith,
  systemRunId,
  type SystemServer,
} from '../testing/interaction-servers/system-calls.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { settledRun } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const measured = { NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'] ?? '' };

const notARequest: unknown = expect.stringContaining('The run is not a request');

const withinItsCall =
  'The run takes place within the call that started it, which no server can interrupt from outside, so it cannot be cancelled; it ends when that call does';

const callFacts = ['run_started', 'tool_call_started', 'tool_call_answered', 'run_succeeded'];

describe('a run that asks a system whose session or process is gone', () => {
  it('opens a session its server forgot once more, and answers', async () => {
    const server = await askingASystem();
    await server.define('asking');
    server.fake.answerNextOf('tools/call', 404);

    expect(await server.runCall('asking')).toMatchObject({ status: 200, body: { status: 'succeeded' } });
  });

  it('starts a process that exited once more, after a call that ended it could not say whether it changed something', async () => {
    const server = await interactionServerOn({
      TOOL_SERVERS: JSON.stringify({
        notes: {
          command: process.execPath,
          args: [fakeStdioServerPath()],
          env: { NODE_V8_COVERAGE: '${NODE_V8_COVERAGE:-}' },
          org: 'acme',
        },
      }),
      ...measured,
    });
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    const define = (name: string, tool: string, written: readonly string[] = []) =>
      server.call('POST', `${alpha}/definitions/interaction`, {
        body: { name, source: callDocument({ server: 'notes', ...calling(tool, written) }) },
      });
    await define('exiting', 'exit');
    await define('searching', 'search', ['    query: acme']);

    const exited = await server.call('POST', `${alpha}/definitions/interaction/exiting/run`, { body: { input: {} } });
    const restarted = await server.call('POST', `${alpha}/definitions/interaction/searching/run`, {
      body: { input: {} },
    });

    expect([exited.status, exited.body]).toEqual([
      409,
      problemWith({ kind: 'effect_unknown', because: 'server_failed' }),
    ]);
    expect(restarted.body).toMatchObject({ status: 'succeeded', output: 'Found 2 rows for acme.' });
  });
});

async function sleeping(): Promise<SystemServer> {
  const server = await askingASystem();
  await server.define('sleeping', calling('sleep', ['    ms: 1000']));
  return server;
}

interface Posting {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

async function leftOnceCalled(server: SystemServer, url: string, { headers, body }: Posting): Promise<unknown> {
  const leaving = new AbortController();
  const gone: Promise<unknown> = fetch(url, { method: 'POST', headers, body, signal: leaving.signal }).catch(
    (error: unknown) => error,
  );
  await until(
    () => Promise.resolve(server.fake.received().length),
    (received) => received === 1,
  );
  leaving.abort();
  return gone;
}

describe('a run that asks a system while its call is in flight, over HTTP', () => {
  it('goes on to its end when its caller goes away, records the answer, and is no request anyone can answer', async () => {
    const server = await sleeping();
    await leftOnceCalled(server, `${server.origin}${alpha}/definitions/interaction/sleeping/run`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: {}, run_id: systemRunId }),
    });

    const cancelling = await server.call('POST', `${alpha}/runs/${systemRunId}/cancel`, { body: { reason: 'Stop' } });
    const answering = await server.call('POST', `${alpha}/runs/${systemRunId}/answer`, { body: { answer: {} } });
    const ended = await settledRun(server, `${alpha}/runs/${systemRunId}`);
    const listed = await server.call('GET', `${alpha}/interactions`);

    expect([cancelling.status, cancelling.body]).toEqual([409, problemWith({ detail: withinItsCall })]);
    expect([answering.status, answering.body]).toEqual([409, problemWith({ detail: notARequest })]);
    expect(ended.body).toMatchObject({ status: 'succeeded', output: 'Slept.' });
    expect((await server.history(systemRunId)).map(({ type }) => type)).toEqual(callFacts);
    expect(listed.body).toMatchObject({ interactions: [] });
  });
});

describe('a run that asks a system while its call is in flight, over MCP', () => {
  it('goes on to its end when its caller goes away, records the answer, calls once and lets the session go', async () => {
    const server = await sleeping();
    const call = {
      name: 'run_definition',
      arguments: { type: 'interaction', name: 'sleeping', input: {}, run_id: systemRunId },
    };
    await leftOnceCalled(server, `${server.origin}/orgs/acme/playbooks/alpha/mcp`, {
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: call }),
    });

    const ended = await settledRun(server, `${alpha}/runs/${systemRunId}`);
    const sessionsEnded = await until(
      () => Promise.resolve(server.fake.endedSessions()),
      (count) => count === 1,
    );

    expect(ended.body).toMatchObject({ status: 'succeeded', output: 'Slept.' });
    expect((await server.history(systemRunId)).map(({ type }) => type)).toEqual(callFacts);
    expect([server.fake.received().length, sessionsEnded]).toEqual([1, 1]);
  });
});
