import { setImmediate } from 'node:timers/promises';

import { InMemoryTransport, parseJSONRPCMessage } from '@modelcontextprotocol/server';
import { Effect, Fiber, Queue, type Scope } from 'effect';
import { TestClock } from 'effect/testing';

import { relay } from '../../agent-relay/mcp-relay.ts';
import { relayBounds } from '../../agent-relay/relay-bounds.ts';
import type { Recover } from '../../agent-relay/shared-recovery.ts';
import type { PingOutcome } from '../../runtime-recovery/runtime-ping.ts';
import type { Recovery } from '../../runtime-recovery/runtime-recovery.ts';
import type { FakeRuntime } from './fake-runtime.ts';

interface ScriptedRecovery {
  readonly recovery: Recovery;
  readonly afterMs?: number;
}

export interface Scripted {
  readonly pings?: readonly PingOutcome[];
  readonly recoveries?: readonly ScriptedRecovery[];
}

interface RecoveryAsked {
  readonly seen: PingOutcome;
  readonly heardBefore: boolean;
}

export interface Relayed {
  readonly send: (message: unknown) => Effect.Effect<void>;
  readonly next: Effect.Effect<unknown>;
  readonly leave: Effect.Effect<void>;
  readonly ended: Effect.Effect<void>;
  readonly reported: () => readonly string[];
  readonly recoveries: () => readonly RecoveryAsked[];
  readonly pings: () => number;
  readonly agentEndFails: (error: Readonly<Error>) => void;
}

export const runs: Recovery = { runs: true };

export const settled: Effect.Effect<void> = Effect.promise(() => setImmediate()).pipe(
  Effect.andThen(Effect.promise(() => setImmediate())),
);

interface Pinging {
  readonly ping: Effect.Effect<PingOutcome>;
  readonly pings: () => number;
}

function pinging(script: readonly PingOutcome[]): Pinging {
  const left = [...script];
  let pings = 0;
  return {
    ping: Effect.suspend(() => {
      pings += 1;
      const outcome = left.shift() ?? 'answers';
      return outcome === 'silent' ? Effect.never : Effect.succeed(outcome);
    }),
    pings: () => pings,
  };
}

interface Recovering {
  readonly recover: Recover;
  readonly asked: () => readonly RecoveryAsked[];
}

function recovering(script: readonly ScriptedRecovery[]): Recovering {
  const left = [...script];
  const asked: RecoveryAsked[] = [];
  return {
    recover: (seen, heardBefore) => {
      asked.push({ seen, heardBefore });
      const { recovery, afterMs } = left.shift() ?? { recovery: runs };
      return afterMs === undefined ? Effect.succeed(recovery) : Effect.sleep(afterMs).pipe(Effect.as(recovery));
    },
    asked: () => [...asked],
  };
}

export function relayedTo(
  runtime: Pick<FakeRuntime, 'open'>,
  script: Scripted = {},
): Effect.Effect<Relayed, never, Scope.Scope> {
  return Effect.gen(function* () {
    const [agent, relayEnd] = InMemoryTransport.createLinkedPair();
    const answers = yield* Queue.unbounded<unknown>();
    const reported: string[] = [];
    const pinged = pinging(script.pings ?? []);
    const recovered = recovering(script.recoveries ?? []);
    Object.assign(agent, {
      onmessage: (message: unknown) => {
        Queue.offerUnsafe(answers, message);
      },
    });
    const relaying = yield* Effect.forkScoped(
      relay({
        agent: () => relayEnd,
        runtime: runtime.open,
        ping: pinged.ping,
        recover: recovered.recover,
        report: (line) => {
          reported.push(line);
        },
        bounds: relayBounds,
      }),
    );
    yield* settled;
    yield* Effect.promise(() => agent.start());
    return {
      send: (message) => Effect.promise(() => agent.send(parseJSONRPCMessage(message))).pipe(Effect.andThen(settled)),
      next: Queue.take(answers),
      leave: Effect.promise(() => agent.close()).pipe(Effect.andThen(settled)),
      ended: Fiber.join(relaying),
      reported: () => [...reported],
      recoveries: recovered.asked,
      pings: pinged.pings,
      agentEndFails: (error) => {
        relayEnd.onerror?.(error);
      },
    };
  });
}

export function ranOnATestClock<A>(program: Effect.Effect<A, never, Scope.Scope>): Promise<A> {
  return Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(TestClock.layer())));
}

export function after(milliseconds: number): Effect.Effect<void> {
  return TestClock.adjust(milliseconds).pipe(Effect.andThen(settled));
}
