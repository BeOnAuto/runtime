import { setImmediate } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import {
  answeredWithStatus,
  callATool,
  cutOffMidAnswer,
  droppedAfterTheRequest,
  fakeRuntime,
  listTools,
  refusedAtConnect,
  relayed,
  type Timers,
  type Turn,
} from '../testing/relays/fake-relays.ts';
import { until } from '../testing/waiting/until.ts';
import { answerAwaitedMs, mayHaveTakenEffect, recoveryAwaitedMs, stillComing } from './mcp-relay.ts';

async function firedOnceArmed(timers: Timers): Promise<void> {
  await until(() => {
    expect(timers.armed(answerAwaitedMs)).toBe(1);
  });
  timers.fire(answerAwaitedMs);
}

describe('relaying an agent to a runtime that may have taken the request', () => {
  it.each<readonly [string, Turn]>([
    ['whose answer was cut off', cutOffMidAnswer],
    ['whose connection closed after it went out', droppedAfterTheRequest],
    ['whose answer never came before its stream ended', 'drops the answer'],
  ])(
    'makes sure the runtime runs, then sends a request %s again when sending it twice changes nothing',
    async (_case, turn) => {
      const runtime = fakeRuntime({ turns: [turn] });
      const { agent, next, recovered } = await relayed(() => runtime.transport);

      await agent.send(listTools);

      expect(await next()).toEqual({ jsonrpc: '2.0', id: 2, result: { tools: [] } });
      expect(recovered()).toBe(1);
      expect(runtime.sends()).toBe(2);
    },
  );

  it.each<readonly [string, Turn]>([
    ['whose answer was cut off', cutOffMidAnswer],
    ['whose answer never came before its stream ended', 'drops the answer'],
  ])('never sends a tool call %s again, and says to check whether it took effect', async (_case, turn) => {
    const runtime = fakeRuntime({ turns: [turn] });
    const { agent, next, recovered } = await relayed(() => runtime.transport);

    await agent.send(callATool);

    expect(await next()).toEqual({ jsonrpc: '2.0', id: 3, error: { code: -32_603, message: mayHaveTakenEffect } });
    expect(recovered()).toBe(1);
    expect(runtime.sends()).toBe(1);
  });

  it.each<readonly [string, Readonly<Error>, string]>([
    ['without one', new Error('Error POSTing to endpoint: busy'), 'Error: Error POSTing to endpoint: busy'],
    ['of its own', answeredWithStatus(503), 'SdkHttpError: Error POSTing to endpoint: 503'],
  ])(
    'answers a request the runtime answered with an error status %s with that error, and never sends it again',
    async (_case, failure, problem) => {
      const runtime = fakeRuntime({ turns: [failure] });
      const { agent, next, recovered } = await relayed(() => runtime.transport);

      await agent.send(listTools);

      expect(await next()).toEqual({ jsonrpc: '2.0', id: 2, error: { code: -32_603, message: problem } });
      expect(runtime.sends()).toBe(1);
      expect(recovered()).toBe(0);
    },
  );
});

describe('a request the runtime does not start to answer', () => {
  it('is given up once the runtime does not answer either, then sent again to the runtime made sure of', async () => {
    const runtime = fakeRuntime({ turns: ['hangs'] });
    const { agent, next, recovered, timers } = await relayed(() => runtime.transport, { answering: [false] });

    await agent.send(listTools);
    await firedOnceArmed(timers);

    expect(await next()).toEqual({ jsonrpc: '2.0', id: 2, result: { tools: [] } });
    expect(recovered()).toBe(1);
  });

  it('is waited for as long as the runtime answers, as a long tool call is', async () => {
    const runtime = fakeRuntime({ turns: ['resolves late'] });
    const { agent, next, recovered, timers } = await relayed(() => runtime.transport);

    await agent.send(callATool);
    await firedOnceArmed(timers);
    await firedOnceArmed(timers);
    await until(() => {
      expect(timers.armed(answerAwaitedMs)).toBe(1);
    });
    runtime.resolveLate();

    expect(await next()).toEqual({ jsonrpc: '2.0', id: 3, result: { tools: [] } });
    expect(recovered()).toBe(0);
    await until(() => {
      expect(timers.armed(answerAwaitedMs)).toBe(0);
    });
  });

  it('is not given up when its answer starts while the runtime is being asked whether it answers', async () => {
    const runtime = fakeRuntime({ turns: ['resolves late'] });
    const asked = Promise.withResolvers<boolean>();
    const { agent, next, recovered, timers } = await relayed(() => runtime.transport, {
      answeringWith: () => asked.promise,
    });

    await agent.send(callATool);
    await firedOnceArmed(timers);
    runtime.resolveLate();
    const answer = await next();
    await setImmediate();
    asked.resolve(false);
    await setImmediate();

    expect(answer).toEqual({ jsonrpc: '2.0', id: 3, result: { tools: [] } });
    expect([recovered(), runtime.sends(), timers.armed(answerAwaitedMs)]).toEqual([0, 1, 0]);
  });
});

describe('a recovery that takes longer than an agent waits', () => {
  it('answers the request that the runtime is still coming, and lets another request wait on the same recovery', async () => {
    const recovering = Promise.withResolvers<string | undefined>();
    const runtime = fakeRuntime({ turns: [refusedAtConnect, refusedAtConnect] });
    const { agent, next, recovered, timers } = await relayed(() => runtime.transport, {
      recover: () => recovering.promise,
    });

    await agent.send(listTools);
    await agent.send(callATool);
    await until(() => {
      expect(timers.armed(recoveryAwaitedMs)).toBe(2);
    });
    timers.fire(recoveryAwaitedMs);
    const answers = [await next(), await next()];
    recovering.resolve('Auto Runtime did not start on port 5555');

    expect(answers).toEqual([
      { jsonrpc: '2.0', id: 2, error: { code: -32_603, message: stillComing } },
      { jsonrpc: '2.0', id: 3, error: { code: -32_603, message: stillComing } },
    ]);
    expect(recovered()).toBe(1);
  });
});
