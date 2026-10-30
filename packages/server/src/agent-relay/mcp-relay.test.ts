import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Recovery } from '../runtime-recovery/runtime-recovery.ts';
import { fakeRuntime } from '../testing/relays/fake-runtime.ts';
import { ranOnATestClock, relayedTo, runs } from '../testing/relays/relayed-agent.ts';

const listTools = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'an-agent', version: '1.0.0' } },
};

const initialized = { jsonrpc: '2.0', method: 'notifications/initialized' };

const startProblem = 'Auto Runtime did not start on port 5555; its log is ~/.auto-runtime/runtime.log';

const leftAlone: Recovery = { runs: false, words: startProblem };

const answerToTheAgent = { jsonrpc: '2.0', id: 'a-1', result: { action: 'accept' } };

describe('relaying an agent to the runtime', () => {
  it('sends what the agent asks to the runtime, and its answer back', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime();
        const relayed = yield* relayedTo(runtime);

        yield* relayed.send(listTools);

        expect(yield* relayed.next).toEqual({ jsonrpc: '2.0', id: 2, result: { tools: [] } });
        expect(runtime.sent()).toEqual([listTools]);
      }),
    ));

  it('tells the runtime the protocol version the agent and the runtime agreed on, and nothing for a later answer', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime();
        const relayed = yield* relayedTo(runtime);

        yield* relayed.send(initialize);
        yield* relayed.next;
        yield* relayed.send(initialized);
        yield* relayed.send(listTools);
        yield* relayed.next;

        expect(runtime.negotiated()).toEqual(['2025-11-25']);
      }),
    ));
});

describe('the protocol version of a relay', () => {
  it('agrees on nothing when the answer to initialize names no version', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['answers bare']);
        const relayed = yield* relayedTo(runtime);

        yield* relayed.send(initialize);
        yield* relayed.next;

        expect(runtime.negotiated()).toEqual([]);
      }),
    ));

  it('relays to a runtime connection that keeps no protocol version', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const relayed = yield* relayedTo(fakeRuntime([], false));

        yield* relayed.send(initialize);

        expect(yield* relayed.next).toMatchObject({ id: 1, result: { protocolVersion: '2025-11-25' } });
      }),
    ));

  it('passes on what the agent answers the runtime, and a notification', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime();
        const relayed = yield* relayedTo(runtime);

        yield* relayed.send(answerToTheAgent);
        yield* relayed.send(initialized);

        expect(runtime.sent()).toEqual([answerToTheAgent, initialized]);
        expect(relayed.reported()).toEqual([]);
      }),
    ));
});

describe('the errors of the two connections of the relay', () => {
  it('reports those of the connection to the runtime, and those of the connection to the agent', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime();
        const relayed = yield* relayedTo(runtime);

        runtime.fails(new Error('the runtime connection broke'));
        relayed.agentEndFails(new Error('the agent connection broke'));

        expect(relayed.reported()).toEqual(['the runtime connection broke', 'the agent connection broke']);
      }),
    ));
});

describe('what the runtime says before it answers', () => {
  it('is passed on to the agent, and then the answer', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const relayed = yield* relayedTo(fakeRuntime(['notifies']));

        yield* relayed.send(listTools);

        expect([yield* relayed.next, yield* relayed.next]).toEqual([
          { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 2, progress: 1 } },
          { jsonrpc: '2.0', id: 2, result: { tools: [] } },
        ]);
      }),
    ));
});

describe('an error the runtime answers', () => {
  it('is the answer, passed on to the agent and never sent again', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['errs']);
        const relayed = yield* relayedTo(runtime);

        yield* relayed.send(listTools);

        expect(yield* relayed.next).toEqual({
          jsonrpc: '2.0',
          id: 2,
          error: { code: -32_602, message: 'No such tool' },
        });
        expect(runtime.sent()).toEqual([listTools]);
      }),
    ));
});

describe('the end of a relay', () => {
  it('closes its connection to the runtime and ends once the agent leaves', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime();
        const relayed = yield* relayedTo(runtime);

        yield* relayed.leave;
        yield* relayed.ended;

        expect(runtime.closed()).toBe(true);
      }),
    ));
});

describe('a request the agent cancels', () => {
  it('stops the call it is waiting for, sends nothing about it, and answers nothing', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['streams']);
        const relayed = yield* relayedTo(runtime);

        yield* relayed.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'run', arguments: {} } });
        yield* relayed.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 3 } });
        yield* relayed.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 9 } });
        yield* relayed.send(listTools);

        expect(yield* relayed.next).toMatchObject({ id: 2 });
        expect(runtime.aborted()).toEqual([3]);
        expect(runtime.sent()).toHaveLength(2);
      }),
    ));
});

describe('a notification the runtime did not take', () => {
  it('is sent again once the runtime runs, when the connection was refused', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['refuses']);
        const relayed = yield* relayedTo(runtime);

        yield* relayed.send(initialized);

        expect(runtime.sent()).toEqual([initialized, initialized]);
        expect(relayed.reported()).toEqual([]);
      }),
    ));

  it('is reported, with no one to answer, when it fails again or the runtime does not run', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const runtime = fakeRuntime(['refuses', 'refuses', 'refuses']);
        const relayed = yield* relayedTo(runtime, { recoveries: [{ recovery: runs }, { recovery: leftAlone }] });

        yield* relayed.send(initialized);
        yield* relayed.send(initialized);

        expect(relayed.reported()).toEqual([
          'Auto Runtime did not take a message: TypeError: fetch failed',
          startProblem,
        ]);
      }),
    ));
});
