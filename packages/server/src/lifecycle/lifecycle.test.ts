import type { RegisterRoutes } from '@on.auto/api';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { servedBy, type Served, type ServerOptions } from '../server-options/server-options.ts';
import { optionsComposing, optionsServing, defaultServerOptions } from '../testing/entries/serving-options.ts';
import { heldRequests } from '../testing/entries/test-routes.ts';
import { isAcceptingConnections } from '../testing/processes/accepting-connections.ts';
import { longerThanTheTestMs } from '../testing/waiting/until.ts';
import { startServer } from './lifecycle.ts';

const loopback = { HOST: '127.0.0.1', PORT: '0' };

function serving(routes: RegisterRoutes, shutdownTimeoutMs = longerThanTheTestMs): ServerOptions<never> {
  return { ...optionsServing(() => servedBy([routes])), shutdownTimeoutMs };
}

function heldAt(port: number): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/held`);
}

function recordingDisposal(): { services: Layer.Layer<never>; events: string[] } {
  const events: string[] = [];
  const recording = Layer.effectDiscard(
    Effect.addFinalizer(() =>
      Effect.sync(() => {
        events.push('runtime disposed');
      }),
    ),
  );
  return { services: recording, events };
}

function recordingWork(record: (event: string) => void): Served {
  return {
    routes: [
      (routes) => {
        routes.onClose(() => {
          record('routes closed');
          return Promise.resolve();
        });
      },
    ],
    stopWork: () => {
      record('work stopped');
      return Promise.resolve();
    },
  };
}

describe('startServer', () => {
  it('listens on the port the operating system assigns for port 0', async () => {
    const server = await startServer({ HOST: '127.0.0.1', PORT: '0' }, defaultServerOptions);

    expect(await isAcceptingConnections(server.port)).toBe(true);
    await server.stop();
  });

  it('stops accepting connections once stopped, and stopping again is harmless', async () => {
    const server = await startServer({ HOST: '127.0.0.1', PORT: '0' }, defaultServerOptions);
    await server.stop();
    await server.stop();

    expect(await isAcceptingConnections(server.port)).toBe(false);
  });

  it('rejects when the port is already taken', async () => {
    const first = await startServer({ HOST: '127.0.0.1', PORT: '0' }, defaultServerOptions);

    await expect(startServer({ ...loopback, PORT: String(first.port) }, defaultServerOptions)).rejects.toThrow(
      'EADDRINUSE',
    );
    await first.stop();
  });
});

describe('the runtime of a server that cannot start', () => {
  it('is disposed before start-up rejects because the port is already taken', async () => {
    const first = await startServer(loopback, defaultServerOptions);
    const { services, events } = recordingDisposal();

    const failure = await startServer(
      { ...loopback, PORT: String(first.port) },
      optionsComposing(services, () =>
        recordingWork((event) => {
          events.push(event);
        }),
      ),
    ).then(
      () => 'started',
      (error: unknown) => {
        events.push('start-up rejected');
        return String(error);
      },
    );
    await first.stop();

    expect(failure).toContain('EADDRINUSE');
    expect(events).toEqual(['work stopped', 'runtime disposed', 'routes closed', 'start-up rejected']);
  });

  it('is disposed before start-up rejects because its routes cannot be built', async () => {
    const { services, events } = recordingDisposal();

    const failure = await startServer(
      loopback,
      optionsComposing(services, () => Promise.reject(new Error('The routes cannot be built'))),
    ).then(
      () => 'started',
      (error: unknown) => {
        events.push('start-up rejected');
        return String(error);
      },
    );

    expect(failure).toBe('Error: The routes cannot be built');
    expect(events).toEqual(['runtime disposed', 'start-up rejected']);
  });
});

describe('the runtime of a started server', () => {
  it('is kept until the server stops', async () => {
    const { services, events } = recordingDisposal();

    const keptUntilStopped = optionsComposing(services, () => servedBy([]));
    const server = await startServer(loopback, keptUntilStopped);
    const whileRunning = [...events];
    await server.stop();

    expect({ whileRunning, afterStopping: events }).toEqual({ whileRunning: [], afterStopping: ['runtime disposed'] });
  });
});

describe('the work a started server does besides answering requests', () => {
  it('stops after the server stopped accepting connections, and before the runtime is disposed', async () => {
    const { services, events } = recordingDisposal();
    const listening = { port: 0 };
    const served = {
      routes: [],
      stopWork: async () => {
        const accepting = await isAcceptingConnections(listening.port);
        events.push(`work stopped, accepting connections: ${String(accepting)}`);
      },
    };

    const server = await startServer(
      loopback,
      optionsComposing(services, () => served),
    );
    listening.port = server.port;
    await server.stop();

    expect(events).toEqual(['work stopped, accepting connections: false', 'runtime disposed']);
  });
});

describe('startServer with routes', () => {
  it('serves the routes it is given', async () => {
    const held = heldRequests();
    const server = await startServer(loopback, serving(held.routes));
    held.release();

    const response = await heldAt(server.port);
    await server.stop();

    expect({ status: response.status, body: await response.json() }).toEqual({ status: 200, body: { held: true } });
  });

  it('answers an unexpected error with a 500 problem document', async () => {
    const server = await startServer(loopback, serving(heldRequests().routes));

    const response = await fetch(`http://127.0.0.1:${server.port}/fail`);
    await server.stop();

    expect({ status: response.status, body: await response.json() }).toMatchObject({
      status: 500,
      body: { reason: 'internal' },
    });
  });
});

describe('stopping a started server', () => {
  it('lets a request in flight finish, then stops without waiting for the shutdown timeout', async () => {
    const held = heldRequests();
    const server = await startServer(loopback, serving(held.routes));
    const inFlight = heldAt(server.port);
    await held.arrived;

    const stopping = server.stop();
    held.release();
    await stopping;
    const response = await inFlight;

    expect({ status: response.status, body: await response.json() }).toEqual({ status: 200, body: { held: true } });
  });
});

describe('the work a stopping server does besides answering requests', () => {
  it('stops while the requests in flight finish, not after them', async () => {
    const held = heldRequests();
    const workStopping = Promise.withResolvers<void>();
    const server = await startServer(loopback, {
      ...optionsServing(() => ({
        routes: [held.routes],
        stopWork: () => {
          workStopping.resolve();
          return Promise.resolve();
        },
      })),
      shutdownTimeoutMs: longerThanTheTestMs,
    });
    const inFlight = heldAt(server.port);
    await held.arrived;

    const stopping = server.stop();
    await workStopping.promise;
    held.release();
    await stopping;

    expect((await inFlight).status).toBe(200);
  });
});

describe('stopping a started server with connections still open', () => {
  it('closes a keep-alive connection that is idle, instead of waiting for it until the shutdown timeout', async () => {
    const server = await startServer(loopback, {
      ...defaultServerOptions,
      shutdownTimeoutMs: longerThanTheTestMs,
    });
    await (await fetch(`http://127.0.0.1:${server.port}/health`)).text();

    await server.stop();

    expect(await isAcceptingConnections(server.port)).toBe(false);
  });

  it('cuts off a request still running at the shutdown timeout', async () => {
    const held = heldRequests();
    const server = await startServer(loopback, serving(held.routes, 100));
    const inFlight = heldAt(server.port).then(
      () => 'answered',
      () => 'cut off',
    );
    await held.arrived;

    await server.stop();

    expect(await inFlight).toBe('cut off');
  });
});
