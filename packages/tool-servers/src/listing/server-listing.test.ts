import { Effect, Option, Result } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { defaultTiming } from '../bounds/call-bounds.ts';
import type { LoopbackServer } from '../testing/fetch-handler.ts';
import {
  fakeMcpInProcess,
  inProcessFetch,
  manualTimer,
  recordingCallJournal,
  reportingAccess,
  toolRun,
} from '../testing/index.ts';
import { serveOnLoopback } from '../testing/loopback-server.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const hanging = new Promise<Response>(() => {});

async function silentOnListing(): Promise<LoopbackServer> {
  const fake = fakeMcpInProcess();
  const forwards: Promise<Response>[] = [];
  let forwarding = true;
  const proxy = await serveOnLoopback(() => async (request) => {
    const body = await request.text();
    if (body.includes('"tools/list"')) {
      return hanging;
    }
    const { method, headers } = request;
    if (method === 'GET') {
      return new Response(null, { status: 405 });
    }
    if (!forwarding) {
      return new Response(null, { status: 503 });
    }
    const forward = inProcessFetch(fake.url, method === 'POST' ? { method, headers, body } : { method, headers });
    forwards.push(forward);
    return forward;
  });
  closing.push(async () => {
    forwarding = false;
    await Promise.allSettled(forwards);
    await Promise.all([proxy.close(), fake.close()]);
    expect([...proxy.failures(), ...fake.failures()]).toEqual([]);
  });
  return proxy;
}

describe('listing the tools of a server as a run opens them', () => {
  it('takes at most the bound of opening a client, not the bound of a call, which is longer than the test', async () => {
    const server = await silentOnListing();
    const bound = manualTimer();
    const { access } = reportingAccess(
      { graph: { url: `${server.origin}/mcp`, org: 'acme' } },
      { timing: { ...defaultTiming, openMs: 300, timer: bound.timer } },
    );
    closing.push(access.close);

    const opening = Effect.runPromise(
      Effect.result(access.open(toolRun(recordingCallJournal()), [{ server: 'graph', tool: 'search' }])),
    );
    await bound.waited(2);
    bound.fire();
    const opened = await opening;

    expect(Option.getOrUndefined(Result.getFailure(opened))).toMatchObject({
      _tag: 'tool_server_failed',
      because: 'unreachable',
    });
  });
});
