import { parseJSONRPCMessage } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';

import {
  answeredWithStatus,
  callATool,
  fakeRuntime,
  fakeRuntimeEnd,
  idOf,
  initialize,
  initialized,
  listTools,
  refusedAtConnect,
  relayed,
  type Reply,
} from '../testing/relays/fake-relays.ts';
import { until } from '../testing/waiting/until.ts';

const agreeOnAVersion: Reply = (message) =>
  idOf(message) === undefined
    ? undefined
    : { jsonrpc: '2.0', id: idOf(message), result: { protocolVersion: '2025-11-25', capabilities: {} } };

const nameNoVersion: Reply = (message) => ({ jsonrpc: '2.0', id: idOf(message), result: {} });

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

const refuseTheCall: Reply = (message) => ({
  jsonrpc: '2.0',
  id: idOf(message),
  error: { code: -32_602, message: 'Unknown tool: run_nothing' },
});

describe('what the runtime sends the agent', () => {
  it('relays an error it answers a request with, as the answer to that request', async () => {
    const runtime = fakeRuntime({ reply: refuseTheCall });
    const { agent, next, recovered } = await relayed(() => runtime.transport);

    await agent.send(callATool);

    expect(await next()).toEqual({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32_602, message: 'Unknown tool: run_nothing' },
    });
    expect([recovered(), runtime.sends()]).toEqual([0, 1]);
  });

  it('relays a notification it sends of its own accord', async () => {
    const runtime = fakeRuntime();
    const { next } = await relayed(() => runtime.transport);

    runtime.transport.onmessage?.(parseJSONRPCMessage({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }));

    expect(await next()).toEqual({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
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

describe('relaying an agent to a runtime its request never reached', () => {
  it.each<readonly [string, Readonly<Error>]>([
    ['whose connection could not be made', refusedAtConnect],
    ['that asked for a credential', answeredWithStatus(401)],
  ])('makes sure the runtime runs, then sends a request %s again', async (_case, failure) => {
    const runtime = fakeRuntime({ turns: [failure] });
    const { agent, next, recovered } = await relayed(() => runtime.transport);

    await agent.send(callATool);

    expect(await next()).toEqual({ jsonrpc: '2.0', id: 3, result: { tools: [] } });
    expect(recovered()).toBe(1);
    expect(runtime.sends()).toBe(2);
  });
});

describe('relaying an agent to a runtime it could not make sure of', () => {
  it('answers the request with why the runtime could not be reached', async () => {
    const { agent, next } = await relayed(fakeRuntimeEnd({ turns: [answeredWithStatus(401)] }), {
      problem: 'Auto Runtime on port 5555 asks for a credential, which this MCP entry does not send',
    });

    await agent.send(listTools);

    expect(await next()).toEqual({
      jsonrpc: '2.0',
      id: 2,
      error: {
        code: -32_603,
        message: 'Auto Runtime on port 5555 asks for a credential, which this MCP entry does not send',
      },
    });
  });

  it('answers the request with what went wrong when it fails again', async () => {
    const { agent, next } = await relayed(
      fakeRuntimeEnd({ turns: [refusedAtConnect, new Error('Error POSTing to endpoint')] }),
    );

    await agent.send(listTools);

    expect(await next()).toMatchObject({ id: 2, error: { message: 'Error: Error POSTing to endpoint' } });
  });

  it('answers the request with what the recovery failed with', async () => {
    const { agent, next } = await relayed(fakeRuntimeEnd({ turns: [refusedAtConnect] }), {
      recover: () => Promise.reject(new Error('EACCES: permission denied, open runtime.log')),
    });

    await agent.send(listTools);

    expect(await next()).toMatchObject({
      id: 2,
      error: { message: 'Error: EACCES: permission denied, open runtime.log' },
    });
  });
});

describe('relaying a notification to a runtime that does not answer', () => {
  it('reports a notification it could not deliver, which has no one to answer', async () => {
    const { agent, reported } = await relayed(
      fakeRuntimeEnd({ turns: [refusedAtConnect, new Error('refused again')] }),
    );

    await agent.send(initialized);

    await until(() => {
      expect(reported).toEqual(['Auto Runtime did not take a message: Error: refused again']);
    });
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
