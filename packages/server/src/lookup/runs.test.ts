import { describe, expect, it } from 'vitest';

import {
  calling,
  lookingUp,
  problemWith,
  systemRunId,
  type SystemServer,
} from '../testing/interaction-servers/system-calls.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { settledRun } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const withinItsCall =
  'The run takes place within the call that started it, which no server can interrupt from outside, so it cannot be cancelled; it ends when that call does';

const callFacts = ['run_started', 'tool_call_started', 'tool_call_answered', 'run_succeeded'];

describe('a run of a lookup function whose session is gone', () => {
  it('opens a session its server forgot once more, and answers', async () => {
    const server = await lookingUp();
    await server.define('asking');
    server.fake.answerNextOf('tools/call', 404);

    expect(await server.runCall('asking')).toMatchObject({ status: 200, body: { status: 'succeeded' } });
  });
});

async function sleeping(): Promise<SystemServer> {
  const server = await lookingUp();
  await server.define('sleeping', calling('sleep', ['    ms: 1000']));
  return server;
}

async function leftOnceCalled(server: SystemServer, url: string, body: string): Promise<unknown> {
  const leaving = new AbortController();
  const gone: Promise<unknown> = fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: leaving.signal,
  }).catch((error: unknown) => error);
  await until(
    () => Promise.resolve(server.fake.received().length),
    (received) => received === 1,
  );
  leaving.abort();
  return gone;
}

describe('a run of a lookup function while its call is in flight, over HTTP', () => {
  it('goes on to its end when its caller goes away, records the answer, and cannot be cancelled meanwhile', async () => {
    const server = await sleeping();
    await leftOnceCalled(
      server,
      `${server.origin}${alpha}/definitions/lookup/sleeping/run`,
      JSON.stringify({ input: {}, run_id: systemRunId }),
    );

    const cancelling = await server.call('POST', `${alpha}/runs/${systemRunId}/cancel`, { body: { reason: 'Stop' } });
    const ended = await settledRun(server, `${alpha}/runs/${systemRunId}`);

    expect([cancelling.status, cancelling.body]).toEqual([409, problemWith({ detail: withinItsCall })]);
    expect(ended.body).toMatchObject({ status: 'succeeded', output: 'Slept.' });
    expect((await server.history(systemRunId)).map(({ type }) => type)).toEqual(callFacts);
  });
});
