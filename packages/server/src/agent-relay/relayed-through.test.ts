import { InMemoryTransport, parseJSONRPCMessage } from '@modelcontextprotocol/server';
import { Effect, Queue, type Scope } from 'effect';
import { describe, expect, it } from 'vitest';

import { probeEveryMs } from '../local-runtime/runtime-probe.ts';
import type { PingOutcome } from '../runtime-recovery/runtime-ping.ts';
import { fakeRuntime, type FakeRuntime } from '../testing/relays/fake-runtime.ts';
import { agentStartingOn, computerWith, startedForAnAgent, type Computer } from '../testing/relays/fake-starting.ts';
import { after, ranOnATestClock, settled } from '../testing/relays/relayed-agent.ts';
import { relayBounds } from './relay-bounds.ts';
import { relayedThrough } from './relayed-through.ts';

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'agent', version: '1.0.0' } },
};

interface RelayedOn {
  readonly send: (message: object) => Effect.Effect<void>;
  readonly next: Effect.Effect<unknown>;
  readonly reported: () => readonly string[];
}

/** The relay of an agent as `auto-runtime mcp` wires it, on a fake computer, runtime and ping, on the test clock. */
function relayedOn(
  computer: Computer,
  runtime: Pick<FakeRuntime, 'open'>,
  pings: readonly PingOutcome[],
): Effect.Effect<RelayedOn, never, Scope.Scope> {
  return Effect.gen(function* () {
    const [agent, relayEnd] = InMemoryTransport.createLinkedPair();
    const answers = yield* Queue.unbounded<unknown>();
    const reported: string[] = [];
    const left = [...pings];
    Object.assign(agent, {
      onmessage: (message: unknown) => {
        Queue.offerUnsafe(answers, message);
      },
    });
    yield* Effect.forkScoped(
      relayedThrough(
        5555,
        {
          agent: () => relayEnd,
          runtime: runtime.open,
          ping: Effect.suspend(() => {
            const outcome = left.shift() ?? 'answers';
            return outcome === 'silent' ? Effect.never : Effect.succeed(outcome);
          }),
          starting: agentStartingOn(computer),
          report: (line) => {
            reported.push(line);
          },
        },
        relayBounds,
      ),
    );
    yield* settled;
    yield* Effect.promise(() => agent.start());
    return {
      send: (message) => Effect.promise(() => agent.send(parseJSONRPCMessage(message))).pipe(Effect.andThen(settled)),
      next: Queue.take(answers),
      reported: () => [...reported],
    };
  });
}

function probeByProbe<A>(program: Effect.Effect<A>): Effect.Effect<A> {
  return Effect.race(program, Effect.forever(after(probeEveryMs)));
}

const { silenceMs, pingTimeoutMs, pingSpacingMs, stopWithinMs } = relayBounds;

const listTools = { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} };

const callTool = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_models', arguments: {} } };

describe('an agent whose runtime, started by its relay, stops answering during a call', () => {
  it('has the call answered once its runtime was asked to stop, killed past the stop bound and replaced, and its next request answered by the new one', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith();
        const runtime = fakeRuntime(['answers', 'stays silent', 'answers']);
        const relayed = yield* relayedOn(computer, runtime, ['silent', 'silent', 'silent']);
        yield* relayed.send(initialize);
        const initialized = yield* relayed.next;

        yield* relayed.send(callTool);
        yield* after(silenceMs + 3 * pingTimeoutMs + 2 * pingSpacingMs);
        const beforeTheStopBound = computer.events();
        yield* after(stopWithinMs);
        const called = yield* probeByProbe(relayed.next);
        yield* relayed.send(listTools);
        const listed = yield* relayed.next;

        expect(initialized).toMatchObject({ id: 1, result: {} });
        expect(beforeTheStopBound).toEqual(['locked', 'started', 'unlocked', 'SIGTERM', 'logged']);
        expect(called).toMatchObject({ id: 2, error: { code: -32_603 } });
        expect(computer.events()).toEqual([
          ...beforeTheStopBound,
          'SIGKILL',
          'logged',
          'locked',
          'started',
          'unlocked',
        ]);
        expect(listed).toMatchObject({ id: 3, result: { tools: [] } });
        expect(runtime.aborted()).toEqual([2]);
      }),
    ));
});

describe('an agent whose runtime in a terminal stops answering during a call', () => {
  it('has the call answered with an error once the silence and the pings passed, and leaves that runtime alone, signalling and starting nothing', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith({ ...startedForAnAgent, started_by: 'terminal', instance: 'in-a-terminal' });
        const runtime = fakeRuntime(['answers', 'stays silent']);
        const relayed = yield* relayedOn(computer, runtime, ['silent', 'silent', 'silent']);
        yield* relayed.send(initialize);
        yield* relayed.next;

        yield* relayed.send(callTool);
        yield* after(silenceMs + 3 * pingTimeoutMs + 2 * pingSpacingMs);

        expect(yield* relayed.next).toMatchObject({ id: 2, error: { code: -32_603 } });
        expect(computer.events()).toEqual([]);
        expect(runtime.aborted()).toEqual([2]);
      }),
    ));
});

describe('an agent whose runtime port another program holds', () => {
  it('is told once why it cannot reach the runtime, and has its request answered with an error, starting nothing', () =>
    ranOnATestClock(
      Effect.gen(function* () {
        const computer = computerWith({ hello: 'world' });
        const relayed = yield* relayedOn(computer, fakeRuntime(['turns away']), ['not a runtime']);

        yield* relayed.send(initialize);

        expect(yield* relayed.next).toMatchObject({ id: 1, error: { code: -32_603 } });
        expect(relayed.reported()).toHaveLength(1);
        expect(computer.events()).toEqual([]);
      }),
    ));
});
