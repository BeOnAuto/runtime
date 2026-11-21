import { Effect, Fiber } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeMcpInProcess, recordingCallJournal, reportingAccess, toolRun } from '../testing/index.ts';
import type { FakeMcpServer } from '../testing/served-fakes.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function fakeServer(): FakeMcpServer {
  const fake = fakeMcpInProcess({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

function accessTo(fake: FakeMcpServer) {
  const { access } = reportingAccess(
    { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
    { environment: { GRAPH_API_KEY: apiKey } },
  );
  closing.push(access.close);
  return access;
}

async function noSessionOpen(fake: FakeMcpServer): Promise<number> {
  await fake.once(() => fake.openSessions() === 0);
  return fake.openSessions();
}

function asked(fake: FakeMcpServer, rpc: string): Promise<void> {
  return fake.once(() => fake.seen().some((seen) => seen.rpc === rpc));
}

async function interruptedOpening(fake: FakeMcpServer, rpc: string): Promise<number> {
  const access = accessTo(fake);
  const opening = Effect.runFork(access.open(toolRun(recordingCallJournal()), [{ server: 'graph', tool: 'search' }]));
  await asked(fake, rpc);
  await Effect.runPromise(Fiber.interrupt(opening));
  return noSessionOpen(fake);
}

async function interruptedOnceItsSessionOpened(fake: FakeMcpServer): Promise<number> {
  const release = fake.holdNextOf('notifications/initialized');
  const access = accessTo(fake);
  const opening = Effect.runFork(access.open(toolRun(recordingCallJournal()), [{ server: 'graph', tool: 'search' }]));
  await asked(fake, 'notifications/initialized');
  const interrupted = Effect.runPromise(Fiber.interrupt(opening));
  release();
  await interrupted;
  return noSessionOpen(fake);
}

describe('a run interrupted while it opens its tools', () => {
  it.each(['initialize', 'notifications/initialized', 'tools/list'])(
    'lets its session go once the opening settles, interrupted once it asks %s',
    async (rpc) => {
      const fake = fakeServer();

      expect(await interruptedOpening(fake, rpc)).toBe(0);
    },
  );

  it('ends the session its server was opening when it was interrupted, which no run holds any more', async () => {
    const fake = fakeServer();

    expect(await interruptedOnceItsSessionOpened(fake)).toBe(0);
    expect(fake.endedSessions()).toBe(1);
  });
});
