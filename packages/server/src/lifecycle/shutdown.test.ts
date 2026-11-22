import { createServer, type Server } from 'node:http';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { stoppedWithinMs } from '@on.auto/operations/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { RunningServer } from '../server-options/server-options.ts';
import { defaultServerOptions } from '../testing/entries/serving-options.ts';
import { isAcceptingConnections, untilItsListenerClosed } from '../testing/processes/accepting-connections.ts';
import { shortShutdownTimeoutMs, shutdownTimeoutVariable } from '../testing/processes/shutdown-timeouts.ts';
import { serverHoldingARequest, spawnServer } from '../testing/processes/spawned-server.ts';
import { gatewayThatHangs, requestTo, settledOver, welcomingStarted } from '../testing/processes/workflow-process.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { testComposition } from '../testing/servers/test-compositions.ts';
import { contributing, givenGoals, runIdIn, workflowSource } from '../testing/servers/workflow-server.ts';
import { noConsentThroughAuto } from '../testing/settings/no-consent-through-auto.ts';
import { longerThanTheTestMs } from '../testing/waiting/until.ts';
import { startServer } from './lifecycle.ts';
import { longestStopMs, shutDown, type ShutdownHooks } from './shutdown.ts';

const serveWithTestRoutes = fileURLToPath(new URL('../testing/entries/serve-with-test-routes.ts', import.meta.url));

const shuttingDownPatiently = { [shutdownTimeoutVariable]: String(longerThanTheTestMs) };

const greeting = workflowSource('greeting', "do:\n  - greet: { set: { greeting: '${ `Hello, ${$data.name}` }' } }\n");

function composedWithALongShutdown(environment: Readonly<Record<string, string>> = {}): Promise<RunningServer> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return startServer(
    {
      HOST: '127.0.0.1',
      PORT: '0',
      LEDGER_FILE: ledger.fileName,
      ...noConsentThroughAuto,
      ...environment,
    },
    { ...testComposition(), shutdownTimeoutMs: longerThanTheTestMs },
  );
}

describe('shutting down the server process', () => {
  it('lets a request in flight finish after SIGTERM and exits 0 once it has, without waiting for the shutdown timeout', async () => {
    const held = await serverHoldingARequest(serveWithTestRoutes, shuttingDownPatiently);
    const { child, port, answer } = held;

    child.signal('SIGTERM');
    await untilItsListenerClosed(held);
    const refusing = !(await isAcceptingConnections(port));
    child.signal('SIGUSR2');

    expect({ refusing, answer: await answer, exitCode: await child.exited }).toEqual({
      refusing: true,
      answer: { status: 200, body: { held: true } },
      exitCode: 0,
    });
  });

  /* That the cut waits for the shutdown timeout, and no less, is proven in process below, on a timer the test moves. */
  it('cuts off a request still running at the shutdown timeout and exits 0', async () => {
    const { child, answer } = await serverHoldingARequest(serveWithTestRoutes, {});

    child.signal('SIGTERM');
    const exitCode = await child.exited;

    expect({ exitCode, answer: await answer }).toEqual({ exitCode: 0, answer: 'unanswered' });
  });
});

/** A server that never listened, so nothing is opened: its close leaves a connection open until it is cut. */
function serverHoldingAConnection(record: (event: string) => void): Server {
  const server = createServer();
  return Object.assign(server, {
    close: () => {
      record('listener closed');
      return server;
    },
    closeAllConnections: () => {
      record('connections cut');
      server.emit('close');
    },
  });
}

function hooksRecordedIn(record: (event: string) => void): ShutdownHooks {
  const step = (event: string) => () => {
    record(event);
    return Promise.resolve();
  };
  return {
    stopWork: step('work stopped'),
    closeApi: step('API closed'),
    disposeRuntime: step('runtime disposed'),
    stopTelemetry: step('telemetry stopped'),
  };
}

interface MovedTimer {
  readonly elapsed: (milliseconds: number) => Promise<void>;
  readonly asked: () => readonly number[];
  readonly pass: (milliseconds: number) => Promise<void>;
}

/** A timer whose waits end only when the test says that many milliseconds passed. */
function movedTimer(): MovedTimer {
  const waits = new Map<number, () => void>();
  return {
    elapsed: (milliseconds) => {
      const wait = Promise.withResolvers<void>();
      waits.set(milliseconds, wait.resolve);
      return wait.promise;
    },
    asked: () => [...waits.keys()],
    pass: async (milliseconds) => {
      waits.get(milliseconds)?.();
      await setImmediate();
    },
  };
}

describe('shutting down a server with a connection still open', () => {
  it.each([50, shortShutdownTimeoutMs, 8000])(
    'closes its listener and stops its work at once, waits %i ms of the shutdown timeout before closing the rest, and cuts the connection only after the grace that follows',
    async (timeoutMs) => {
      const events: string[] = [];
      const record = (event: string): void => {
        events.push(event);
      };
      const timer = movedTimer();

      const shuttingDown = shutDown(
        serverHoldingAConnection(record),
        hooksRecordedIn(record),
        timeoutMs,
        timer.elapsed,
      );
      await setImmediate();
      const beforeTheTimeout = { events: [...events], asked: timer.asked() };
      await timer.pass(timeoutMs);
      const beforeTheGrace = { events: [...events], asked: timer.asked() };
      await timer.pass(100);
      await shuttingDown;

      expect(beforeTheTimeout).toEqual({ events: ['listener closed', 'work stopped'], asked: [timeoutMs] });
      expect(beforeTheGrace).toEqual({
        events: ['listener closed', 'work stopped', 'API closed', 'runtime disposed', 'telemetry stopped'],
        asked: [timeoutMs, 100],
      });
      expect(events.at(-1)).toBe('connections cut');
    },
  );
});

describe('a repeated stop signal', () => {
  it.each<NodeJS.Signals>(['SIGTERM', 'SIGINT'])(
    'ends the server process at once while it shuts down after the first %s, cutting off what still runs, and exits 1',
    async (signal) => {
      const held = await serverHoldingARequest(serveWithTestRoutes, shuttingDownPatiently);
      const { child, port, answer } = held;

      child.signal(signal);
      await untilItsListenerClosed(held);
      const refusing = !(await isAcceptingConnections(port));
      child.signal(signal);

      expect({ refusing, answer: await answer, exitCode: await child.exited }).toEqual({
        refusing: true,
        answer: 'unanswered',
        exitCode: 1,
      });
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

describe('the composition of main, started in the process with a shutdown timeout longer than the test', () => {
  it('stops after a workflow ran, closing the keep-alive connection left idle, without waiting for the timeout', async () => {
    const server = await composedWithALongShutdown();
    await requestTo(server.port, 'POST', '', { playbook: 'alpha', name: 'Alpha', goals: givenGoals });
    await requestTo(server.port, 'POST', '/alpha/definitions/workflow', {
      name: 'greeting',
      source: contributing(greeting),
    });
    const started = await requestTo(server.port, 'POST', '/alpha/definitions/workflow/greeting/run', {
      input: { name: 'Ada' },
    });
    const settled = await settledOver(server.port, `/alpha/runs/${runIdIn(started.body)}`);
    await (await fetch(`http://127.0.0.1:${server.port}/health`)).text();

    await server.stop();

    expect(settled).toMatchObject({ status: 'succeeded', output: { greeting: 'Hello, Ada' } });
    expect(await isAcceptingConnections(server.port)).toBe(false);
  });

  it('stops while a function a workflow called still runs, without waiting for it or for the timeout', async () => {
    const gateway = await gatewayThatHangs();
    const server = await composedWithALongShutdown({ MODEL_GATEWAYS: gateway.gateways });
    await welcomingStarted(server.port, 'beta');
    await gateway.firstHeard;

    await server.stop();

    expect([gateway.requests(), await isAcceptingConnections(server.port)]).toEqual([1, false]);
  });
});
