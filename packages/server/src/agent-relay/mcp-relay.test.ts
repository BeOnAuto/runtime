import { InMemoryTransport, parseJSONRPCMessage, type Transport } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';

import { until } from '../testing/waiting/until.ts';
import { relay } from './mcp-relay.ts';

const listTools = parseJSONRPCMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

const initialize = parseJSONRPCMessage({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'agent', version: '1.0.0' } },
});

const initialized = parseJSONRPCMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });

type Reply = (message: unknown) => unknown;

function idOf(message: unknown): unknown {
  return typeof message === 'object' && message !== null && 'id' in message ? message.id : undefined;
}

const echoTools: Reply = (message) => ({ jsonrpc: '2.0', id: idOf(message), result: { tools: [] } });

const agreeOnAVersion: Reply = (message) =>
  idOf(message) === undefined
    ? undefined
    : { jsonrpc: '2.0', id: idOf(message), result: { protocolVersion: '2025-11-25', capabilities: {} } };

const nameNoVersion: Reply = (message) => ({ jsonrpc: '2.0', id: idOf(message), result: {} });

interface FakeRuntimeOptions {
  readonly reply?: Reply;
  readonly failures?: readonly Readonly<Error>[];
  readonly negotiates?: boolean;
}

interface FakeRuntime {
  readonly transport: Transport;
  readonly received: unknown[];
  readonly negotiated: string[];
  readonly closed: () => boolean;
  readonly sends: () => number;
}

function fakeRuntime({ reply = echoTools, failures = [], negotiates = true }: FakeRuntimeOptions = {}): FakeRuntime {
  const received: unknown[] = [];
  const negotiated: string[] = [];
  const failing = [...failures];
  let closed = false;
  let sends = 0;
  const transport: Transport = {
    start: () => Promise.resolve(),
    send: (message: unknown) => {
      sends += 1;
      const failure = failing.shift();
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      received.push(message);
      const answer = reply(message);
      if (answer !== undefined) {
        queueMicrotask(() => transport.onmessage?.(parseJSONRPCMessage(answer)));
      }
      return Promise.resolve();
    },
    close: () => {
      closed = true;
      return Promise.resolve();
    },
    ...(negotiates
      ? {
          setProtocolVersion: (version: string) => {
            negotiated.push(version);
          },
        }
      : {}),
  };
  return { transport, received, negotiated, closed: () => closed, sends: () => sends };
}

const refusedAtConnect = new TypeError('fetch failed', {
  cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5555'), { code: 'ECONNREFUSED', syscall: 'connect' }),
});

const cutOffMidAnswer = new TypeError('terminated', {
  cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
});

const droppedAfterTheRequest = new TypeError('fetch failed', {
  cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
});

function fakeRuntimeEnd(options: FakeRuntimeOptions = {}): () => Transport {
  const { transport } = fakeRuntime(options);
  return () => transport;
}

interface Relayed {
  readonly agent: Transport;
  readonly relayEnd: Transport;
  readonly reported: string[];
  readonly recovered: () => number;
  readonly ended: Promise<void>;
  readonly next: () => Promise<unknown>;
}

async function relayed(runtimeEnd: () => Transport, recovery?: string): Promise<Relayed> {
  const [agent, relayEnd] = InMemoryTransport.createLinkedPair();
  const reported: string[] = [];
  const answers: unknown[] = [];
  const waiting: ((message: unknown) => void)[] = [];
  let recovered = 0;
  Object.assign(agent, {
    onmessage: (message: unknown) => {
      const waiter = waiting.shift();
      if (waiter === undefined) {
        answers.push(message);
      } else {
        waiter(message);
      }
    },
  });
  const ended = relay({
    agent: () => relayEnd,
    runtime: runtimeEnd,
    recover: () => {
      recovered += 1;
      return Promise.resolve(recovery);
    },
    report: (line) => {
      reported.push(line);
    },
  });
  await agent.start();
  return {
    agent,
    relayEnd,
    reported,
    recovered: () => recovered,
    ended,
    next: () =>
      answers.length > 0
        ? Promise.resolve(answers.shift())
        : new Promise((resolve) => {
            waiting.push(resolve);
          }),
  };
}

describe('relaying an agent to the runtime', () => {
  it('sends what the agent asks to the runtime, and its answer back', async () => {
    const runtime = fakeRuntime();
    const { agent, next } = await relayed(() => runtime.transport);

    await agent.send(listTools);

    expect(await next()).toEqual({ jsonrpc: '2.0', id: 2, result: { tools: [] } });
    expect(runtime.received).toEqual([listTools]);
  });

  it('tells the runtime the protocol version the agent and the runtime agreed on', async () => {
    const runtime = fakeRuntime({ reply: agreeOnAVersion });
    const { agent, next } = await relayed(() => runtime.transport);

    await agent.send(initialize);
    await next();
    await agent.send(initialized);
    await agent.send(listTools);
    await next();

    expect(runtime.negotiated).toEqual(['2025-11-25']);
  });

  it('agrees on nothing when the answer to initialize names no version', async () => {
    const runtime = fakeRuntime({ reply: nameNoVersion });
    const { agent, next } = await relayed(() => runtime.transport);

    await agent.send(initialize);
    await next();

    expect(runtime.negotiated).toEqual([]);
  });

  it('relays to a runtime connection that keeps no protocol version', async () => {
    const { agent, next } = await relayed(fakeRuntimeEnd({ negotiates: false, reply: agreeOnAVersion }));

    await agent.send(initialize);

    expect(await next()).toMatchObject({ id: 1, result: { protocolVersion: '2025-11-25' } });
  });
});

describe('the end of a relay', () => {
  it('closes its connection to the runtime and ends once the agent leaves', async () => {
    const runtime = fakeRuntime();
    const { agent, ended } = await relayed(() => runtime.transport);

    await agent.close();
    await ended;

    expect(runtime.closed()).toBe(true);
  });
});

describe('relaying an agent to a runtime that does not answer', () => {
  it('makes sure the runtime runs, then sends again a request whose connection could not be made', async () => {
    const runtime = fakeRuntime({ failures: [refusedAtConnect] });
    const { agent, next, recovered } = await relayed(() => runtime.transport);

    await agent.send(listTools);

    expect(await next()).toEqual({ jsonrpc: '2.0', id: 2, result: { tools: [] } });
    expect(recovered()).toBe(1);
    expect(runtime.sends()).toBe(2);
  });

  it('answers the request with why the runtime could not be started', async () => {
    const { agent, next } = await relayed(
      fakeRuntimeEnd({ failures: [refusedAtConnect] }),
      'Auto Runtime did not start on port 5555; its log is /Users/ada/.auto-runtime/runtime.log',
    );

    await agent.send(listTools);

    expect(await next()).toEqual({
      jsonrpc: '2.0',
      id: 2,
      error: {
        code: -32_603,
        message: 'Auto Runtime did not start on port 5555; its log is /Users/ada/.auto-runtime/runtime.log',
      },
    });
  });

  it('answers the request with what went wrong when it fails again', async () => {
    const { agent, next } = await relayed(
      fakeRuntimeEnd({ failures: [refusedAtConnect, new Error('Error POSTing to endpoint')] }),
    );

    await agent.send(listTools);

    expect(await next()).toMatchObject({ id: 2, error: { message: 'Error: Error POSTing to endpoint' } });
  });
});

describe('relaying a notification to a runtime that does not answer', () => {
  it('reports a notification it could not deliver, which has no one to answer', async () => {
    const { agent, reported } = await relayed(
      fakeRuntimeEnd({ failures: [refusedAtConnect, new Error('refused again')] }),
    );

    await agent.send(initialized);

    await until(() => {
      expect(reported).toEqual(['Auto Runtime did not take a message: Error: refused again']);
    });
  });
});

describe('relaying an agent to a runtime that may have taken the request', () => {
  it.each<readonly [string, Readonly<Error>, string]>([
    ['whose answer was cut off', cutOffMidAnswer, 'TypeError: terminated'],
    ['whose connection closed after it went out', droppedAfterTheRequest, 'TypeError: fetch failed'],
    [
      'that the runtime answered with an error status',
      new Error('Error POSTing to endpoint: busy'),
      'Error: Error POSTing to endpoint: busy',
    ],
  ])('answers a request %s with what went wrong, and never sends it again', async (_case, failure, problem) => {
    const runtime = fakeRuntime({ failures: [failure] });
    const { agent, next, recovered } = await relayed(() => runtime.transport);

    await agent.send(listTools);

    expect(await next()).toEqual({ jsonrpc: '2.0', id: 2, error: { code: -32_603, message: problem } });
    expect(runtime.sends()).toBe(1);
    expect(recovered()).toBe(0);
  });
});

describe('the errors of the two connections of the relay', () => {
  it('reports those of the connection to the runtime', async () => {
    const runtime = fakeRuntime();
    const { reported } = await relayed(() => runtime.transport);

    runtime.transport.onerror?.(new Error('the runtime connection broke'));

    expect(reported).toEqual(['the runtime connection broke']);
  });

  it('reports those of the connection to the agent', async () => {
    const { relayEnd, reported } = await relayed(fakeRuntimeEnd());

    relayEnd.onerror?.(new Error('the agent connection broke'));

    expect(reported).toEqual(['the agent connection broke']);
  });
});
