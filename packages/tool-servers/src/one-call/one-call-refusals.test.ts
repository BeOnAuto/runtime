import { once } from 'node:events';
import { createServer } from 'node:http';

import { Effect, Function, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { toolBounds } from '../bounds/call-bounds.ts';
import { reportingAccess } from '../testing/index.ts';
import {
  calledOnce,
  closedAfter,
  oneCallAccess,
  oneCallKey,
  oneCallServer,
  failedWith,
  unopenedWith,
} from '../testing/one-calls.ts';

const portOf = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

const alpha = { org: 'acme', playbook: 'alpha' };

const couldNotBeUsed = 'The tool server graph could not be used: ';

describe('a server that cannot take one call now', () => {
  it('hands on the wait a 429 asks for to its caller, without waiting it out in the call', async () => {
    const fake = await oneCallServer();
    const access = oneCallAccess(fake.url);

    fake.answerNextOf('tools/call', 429, 1, { 'retry-after': '120' });

    expect(await calledOnce(access)).toMatchObject(
      failedWith('server_failure', 'The tool server answered HTTP 429', 120_000),
    );
  });

  it('is unopened when the server cannot be reached, or refuses to list its tools, so nothing was sent', async () => {
    const fake = await oneCallServer();
    fake.answerNextOf('tools/list', 503);
    const listingRefused = await calledOnce(oneCallAccess(fake.url));
    const { url } = fake;
    await fake.close();

    expect([listingRefused, await calledOnce(oneCallAccess(url))]).toEqual([
      unopenedWith('tool_server_failed', 'failing', `${couldNotBeUsed}The tool server answered HTTP 503`),
      unopenedWith('tool_server_failed', 'unreachable', `${couldNotBeUsed}The tool server could not be reached`),
    ]);
    expect(fake.received()).toEqual([]);
  });

  it('keeps the words of a failure to 1 KiB, the bound every reader of a failure shares', async () => {
    const fake = await oneCallServer();
    const refusal = 'The gateway refused the request. '.repeat(100);
    const { access } = reportingAccess(
      { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
      { environment: { GRAPH_API_KEY: oneCallKey }, fetch: () => Promise.reject(new Error(refusal)) },
    );
    closedAfter(access.close);

    expect(await calledOnce(access)).toEqual(
      unopenedWith('tool_server_failed', 'failing', `${couldNotBeUsed}${refusal}`.slice(0, toolBounds.failureBytes)),
    );
  });
});

describe('one call through a tool this playbook is not offered', () => {
  it('is refused before anything is sent or recorded, for a server it does not have, of another org, or a tool not allowed', async () => {
    const fake = await oneCallServer();
    const access = oneCallAccess(fake.url);

    expect([
      await calledOnce(access, { reference: { server: 'wiki', tool: 'echo' } }),
      await calledOnce(oneCallAccess(fake.url, { org: 'globex' })),
      await calledOnce(access, { reference: { server: 'graph', tool: 'environment' } }),
    ]).toEqual([
      unopenedWith(
        'tool_not_offered',
        'tool_server_not_configured',
        'No tool server named wiki is configured for this playbook',
      ),
      unopenedWith(
        'tool_not_offered',
        'tool_server_not_configured',
        'No tool server named graph is configured for this playbook',
      ),
      unopenedWith(
        'tool_not_offered',
        'tool_not_allowed',
        'The operator of this server does not allow graph/environment',
      ),
    ]);
    expect(fake.seen()).toEqual([]);
  });

  it('is told by name alone, before any client opens, as a run asks before it records anything', async () => {
    const fake = await oneCallServer();
    const access = oneCallAccess(fake.url);

    expect([
      Result.isSuccess(
        await Effect.runPromise(Effect.result(access.named(alpha, [{ server: 'graph', tool: 'echo' }]))),
      ),
      await Effect.runPromise(Effect.result(access.named(alpha, [{ server: 'graph', tool: 'environment' }]))),
    ]).toMatchObject([true, Result.fail({ because: 'tool_not_allowed' })]);
    expect(fake.seen()).toEqual([]);
  });
});

describe('one call to a server whose client never opens', () => {
  it('fails at the open bound, as unreachable, with nothing sent', async () => {
    const silent = createServer(Function.constVoid);
    silent.listen(0, '127.0.0.1');
    await once(silent, 'listening');
    closedAfter(async () => {
      silent.closeAllConnections();
      silent.close();
      await once(silent, 'close');
    });
    const startedAt = Date.now();

    const ended = await calledOnce(
      oneCallAccess(`http://127.0.0.1:${String(portOf(silent.address()).port)}/mcp`, {}, { openMs: 300 }),
    );

    expect(ended).toEqual(
      unopenedWith(
        'tool_server_failed',
        'unreachable',
        `${couldNotBeUsed}The tool server did not open a connection within 300 ms`,
      ),
    );
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });
});

describe('one call to a server that does not list its tools in time', () => {
  it('fails at the open bound, as unreachable, with nothing sent', async () => {
    const fake = await oneCallServer();
    fake.holdNextOf('tools/list');

    expect(await calledOnce(oneCallAccess(fake.url, {}, { openMs: 300 }))).toEqual(
      unopenedWith('tool_server_failed', 'unreachable', `${couldNotBeUsed}The tool server did not answer in time`),
    );
    expect(fake.received()).toEqual([]);
  });
});
