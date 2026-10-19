import { fileURLToPath } from 'node:url';

import { stoppedWithinMs } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { untilRefusingConnections } from '../testing/processes/accepting-connections.ts';
import { shortShutdownTimeoutMs, shutdownTimeoutVariable } from '../testing/processes/shutdown-timeouts.ts';
import { serverHoldingARequest, spawnServer } from '../testing/processes/spawned-server.ts';
import { longerThanTheTestMs } from '../testing/waiting/until.ts';
import { defaultServerOptions } from './lifecycle.ts';
import { longestStopMs } from './shutdown.ts';

const serveWithTestRoutes = fileURLToPath(new URL('../testing/entries/serve-with-test-routes.ts', import.meta.url));

const shuttingDownPatiently = { [shutdownTimeoutVariable]: String(longerThanTheTestMs) };

describe('shutting down the server process', () => {
  it('lets a request in flight finish after SIGTERM and exits 0 once it has, without waiting for the shutdown timeout', async () => {
    const { child, port, answer } = await serverHoldingARequest(serveWithTestRoutes, shuttingDownPatiently);

    child.signal('SIGTERM');
    await untilRefusingConnections(port);
    child.signal('SIGUSR2');

    expect({ answer: await answer, exitCode: await child.exited }).toEqual({
      answer: { status: 200, body: { held: true } },
      exitCode: 0,
    });
  });

  it('cuts off a request still running at the shutdown timeout, no sooner, and exits 0', async () => {
    const { child, answer } = await serverHoldingARequest(serveWithTestRoutes, {});

    const signalled = performance.now();
    child.signal('SIGTERM');
    const exitCode = await child.exited;

    expect({ exitCode, answer: await answer }).toEqual({ exitCode: 0, answer: 'unanswered' });
    expect(performance.now() - signalled).toBeGreaterThanOrEqual(shortShutdownTimeoutMs - 50);
  });
});

describe('a repeated stop signal', () => {
  it.each<NodeJS.Signals>(['SIGTERM', 'SIGINT'])(
    'ends the server process at once while it shuts down after the first %s, cutting off what still runs, and exits 1',
    async (signal) => {
      const { child, port, answer } = await serverHoldingARequest(serveWithTestRoutes, shuttingDownPatiently);

      child.signal(signal);
      await untilRefusingConnections(port);
      child.signal(signal);

      expect({ answer: await answer, exitCode: await child.exited }).toEqual({ answer: 'unanswered', exitCode: 1 });
      expect(child.output().stderr).toContain(
        'Auto Runtime was told to stop again, so it exits now without finishing its shutdown\n',
      );
    },
  );
});

describe('a server process that something keeps running after it stopped', () => {
  it('exits 0 at the exit deadline and says why on stderr', async () => {
    const child = spawnServer(serveWithTestRoutes, { HOST: '127.0.0.1', PORT: '0' });
    const port = await child.port;
    await (await fetch(`http://127.0.0.1:${port}/linger?ms=60000`)).text();

    child.signal('SIGTERM');

    expect(await child.exited).toBe(0);
    expect(child.output().stderr).toContain(
      `Auto Runtime was still running ${defaultServerOptions.exitDeadlineMs} ms after it stopped, so it exits now\n`,
    );
  });
});

describe('the longest stop of the server process', () => {
  it('is shorter than the bound a test gives a process it started to stop before it is killed', () => {
    expect(longestStopMs).toBeLessThan(stoppedWithinMs);
  });
});
