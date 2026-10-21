import {
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  parseJSONRPCMessage,
  type RequestId,
  type Transport,
} from '@modelcontextprotocol/server';
import { Clock, Effect, Option, Queue, Schema, type Scope } from 'effect';

import { lossOf } from '../runtime-recovery/runtime-losses.ts';
import type { PingOutcome } from '../runtime-recovery/runtime-ping.ts';
import type { Recovery } from '../runtime-recovery/runtime-recovery.ts';
import type { RelayBounds } from './relay-bounds.ts';
import { Liveness } from './relay-liveness.ts';
import { decisionFor, wordsAfter } from './resend-rule.ts';
import { RuntimeCalls, type Cancellation } from './runtime-calls.ts';
import { SharedRecovery, type Recover } from './shared-recovery.ts';

export interface Relaying {
  readonly agent: () => Transport;
  readonly runtime: (heard: (id: RequestId) => void) => Transport;
  readonly ping: Effect.Effect<PingOutcome>;
  readonly recover: Recover;
  readonly report: (line: string) => void;
  readonly bounds: RelayBounds;
}

interface Asked {
  readonly id: RequestId;
  readonly method: string;
  readonly message: unknown;
}

type Scoped<A> = Effect.Effect<A, never, Scope.Scope>;

type Inbound = { readonly message: unknown } | 'left';

type Sending = { readonly failed: false } | { readonly failed: true; readonly failure: unknown };

interface Held {
  readonly arrivedAt: number;
  readonly cancellation: Cancellation;
  readonly reached: boolean;
}

const internalError = -32_603;

const cancellationOf = Schema.decodeUnknownOption(
  Schema.Struct({
    method: Schema.Literal('notifications/cancelled'),
    params: Schema.Struct({ requestId: Schema.Union([Schema.String, Schema.Number]) }),
  }),
);

class McpRelay {
  readonly #relaying: Relaying;
  readonly #inbox = Effect.runSync(Queue.unbounded<Inbound>());
  readonly #calls: RuntimeCalls;
  readonly #recovery: SharedRecovery;
  readonly #agent: Transport;
  readonly #runtime: Transport;
  readonly #initializing = new Set<unknown>();

  constructor(relaying: Relaying) {
    const liveness = new Liveness(relaying.ping, relaying.bounds);
    this.#relaying = relaying;
    this.#calls = new RuntimeCalls(liveness, relaying.bounds);
    this.#recovery = new SharedRecovery(liveness, relaying.recover);
    this.#agent = relaying.agent();
    this.#runtime = relaying.runtime((id) => {
      this.#calls.heardOn(id);
    });
  }

  run(): Scoped<void> {
    Object.assign(this.#runtime, {
      onmessage: (message: unknown) => {
        this.#answered(message);
      },
      onerror: (error: Readonly<Error>) => {
        this.#relaying.report(error.message);
      },
    });
    Object.assign(this.#agent, {
      onmessage: (message: unknown) => {
        Queue.offerUnsafe(this.#inbox, { message });
      },
      onerror: (error: Readonly<Error>) => {
        this.#relaying.report(error.message);
      },
      onclose: () => {
        Queue.offerUnsafe(this.#inbox, 'left');
      },
    });
    return Effect.gen({ self: this }, function* () {
      yield* Effect.promise(() => this.#runtime.start());
      yield* Effect.promise(() => this.#agent.start());
      yield* this.#relayedUntilTheAgentLeaves();
      yield* Effect.promise(() => this.#runtime.close());
    });
  }

  #relayedUntilTheAgentLeaves(): Scoped<void> {
    const next = Queue.take(this.#inbox).pipe(
      Effect.flatMap((inbound) =>
        inbound === 'left' ? Effect.fail(inbound) : Effect.forkScoped(this.#relayed(inbound.message)),
      ),
    );
    return Effect.forever(next).pipe(Effect.flip, Effect.asVoid);
  }

  #answered(message: unknown): void {
    if (this.#calls.stoppedOn(message)) {
      return;
    }
    this.#calls.answered(message);
    if (isJSONRPCResultResponse(message) && this.#initializing.delete(message.id)) {
      const { protocolVersion } = message.result;
      if (typeof protocolVersion === 'string') {
        this.#runtime.setProtocolVersion?.(protocolVersion);
      }
    }
    void this.#agent.send(parseJSONRPCMessage(message));
  }

  #relayed(message: unknown): Scoped<void> {
    if (isJSONRPCRequest(message)) {
      if (message.method === 'initialize') {
        this.#initializing.add(message.id);
      }
      return this.#relayedRequest({ id: message.id, method: message.method, message });
    }
    const cancellation = cancellationOf(message);
    if (Option.isSome(cancellation)) {
      return Effect.sync(() => {
        this.#calls.cancelled(cancellation.value.params.requestId);
      });
    }
    return this.#relayedMessage(message);
  }

  #relayedRequest(asked: Asked): Scoped<void> {
    return Effect.gen({ self: this }, function* () {
      const arrivedAt = yield* Clock.currentTimeMillis;
      const cancellation = this.#calls.asked(asked.id);
      yield* this.#settled(asked, { arrivedAt, cancellation, reached: false }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.#calls.settled(asked.id);
          }),
        ),
      );
    });
  }

  #settled(asked: Asked, held: Held): Scoped<void> {
    return Effect.gen({ self: this }, function* () {
      const ending = yield* this.#calls.attempt(this.#runtime, asked.id, asked.message, held.cancellation);
      if (ending.kind !== 'lost') {
        return;
      }
      const outcome = yield* this.#recoveredWithin(ending.seen, held);
      if (yield* held.cancellation.happened) {
        return;
      }
      const reached = held.reached || ending.loss !== 'refused';
      const decision = decisionFor(asked.method, ending.loss);
      const words = wordsAfter(decision, Option.getOrUndefined(outcome), { reached, said: ending.said });
      if (words !== undefined) {
        this.#refused(asked.id, words);
        return;
      }
      yield* this.#settled(asked, { ...held, reached });
    });
  }

  #recoveredWithin(seen: PingOutcome | undefined, held: Held): Scoped<Option.Option<Recovery>> {
    const { heardBackWithinMs } = this.#relaying.bounds;
    const cancelled = held.cancellation.awaited.pipe(Effect.as(Option.none<Recovery>()));
    return Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) =>
        Effect.raceAll([
          this.#recovery
            .recovered(seen)
            .pipe(Effect.timeoutOption(Math.max(0, heardBackWithinMs - (now - held.arrivedAt)))),
          cancelled,
        ]),
      ),
    );
  }

  #relayedMessage(message: unknown): Scoped<void> {
    return Effect.gen({ self: this }, function* () {
      const sending = yield* this.#sentAlone(message);
      if (!sending.failed || lossOf(sending.failure) !== 'refused') {
        this.#reportedUnless(sending);
        return;
      }
      const recovery = yield* this.#recovery.recovered();
      if (recovery.runs) {
        this.#reportedUnless(yield* this.#sentAlone(message));
        return;
      }
      this.#relaying.report(recovery.words);
    });
  }

  #sentAlone(message: unknown): Effect.Effect<Sending> {
    return Effect.promise(() =>
      this.#runtime.send(parseJSONRPCMessage(message)).then(
        (): Sending => ({ failed: false }),
        (failure: unknown): Sending => ({ failed: true, failure }),
      ),
    );
  }

  #reportedUnless(sending: Sending): void {
    if (sending.failed) {
      this.#relaying.report(`Auto Runtime did not take a message: ${String(sending.failure)}`);
    }
  }

  #refused(id: RequestId, problem: string): void {
    void this.#agent.send(
      parseJSONRPCMessage({ jsonrpc: '2.0', id, error: { code: internalError, message: problem } }),
    );
  }
}

export function relay(relaying: Relaying): Effect.Effect<void> {
  return Effect.scoped(new McpRelay(relaying).run());
}
