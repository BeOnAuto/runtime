import {
  SocketEnded,
  type OpensASocket,
  type SocketFrame,
  type SocketOpening,
  type ThroughTheConnection,
} from '@on.auto/providers';
import type { ConnectionWays } from '@on.auto/tool-servers';
import { Effect, Function, Option, Queue, Redacted } from 'effect';
import { TestClock } from 'effect/testing';

import { answeredWith, type ServiceAnswer } from './held-sockets.ts';

interface Settling {
  readonly done: () => boolean;
  readonly resolve: () => void;
}

/**
 * The sockets of a service as a test drives them: each value opens one, a message is sent down it, and what the
 * runtime acknowledges comes back up, each kept by the value its socket was opened with.
 */
export class ServiceSockets {
  readonly opened: string[] = [];
  readonly closed: string[] = [];
  readonly refusing = new Set<string>();
  readonly codes: SocketOpening['failureCodes'][] = [];
  readonly #downs = new Map<string, Queue.Queue<SocketFrame | 'closed'>>();
  readonly #acknowledged = new Map<string, string[]>();
  #settling: readonly Settling[] = [];

  readonly opens: OpensASocket = ({ credential, failureCodes: codes }) =>
    Effect.gen({ self: this }, function* () {
      const value = Redacted.value(credential);
      this.opened.push(value);
      this.codes.push(codes);
      if (this.refusing.has(value)) {
        return yield* Effect.fail(new SocketEnded({ end: 'refused' }));
      }
      const down = yield* Queue.unbounded<SocketFrame | 'closed'>();
      this.#downs.set(value, down);
      this.#heard();
      yield* Effect.addFinalizer(() => Effect.sync(() => this.closed.push(value)));
      const next = Effect.flatMap(Queue.take(down), (frame) =>
        frame === 'closed' ? Effect.fail(new SocketEnded({ end: 'closed', code: 1001 })) : Effect.succeed(frame),
      );
      const send = (text: string) =>
        Effect.sync(() => {
          this.#acknowledgedOver(value).push(text);
          this.#heard();
        });
      return { next, send, ping: Effect.asVoid(Queue.offer(down, { kind: 'pong' })) };
    });

  readonly sends = (value: string, payload: object): Effect.Effect<void> =>
    this.#down(value, { kind: 'message', text: JSON.stringify(payload) });

  readonly closes = (value: string): Effect.Effect<void> => this.#down(value, 'closed');

  readonly acknowledged = (value: string): readonly string[] => [...this.#acknowledgedOver(value)];

  /** Settles once a socket opened with the value can be sent down. */
  readonly whenOpened = (value: string): Promise<void> => this.#until(() => this.#downs.has(value));

  /** Settles once that many messages sent down the socket of the value are acknowledged. */
  readonly whenAcknowledged = (value: string, count: number): Promise<void> =>
    this.#until(() => this.#acknowledgedOver(value).length >= count);

  #until(done: () => boolean): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.#settling = [...this.#settling, { done, resolve }];
    this.#heard();
    return promise;
  }

  #heard(): void {
    const settled = this.#settling.filter(({ done }) => done());
    this.#settling = this.#settling.filter((settling) => !settled.includes(settling));
    for (const { resolve } of settled) {
      resolve();
    }
  }

  #acknowledgedOver(value: string): string[] {
    const acknowledged = this.#acknowledged.get(value) ?? [];
    this.#acknowledged.set(value, acknowledged);
    return acknowledged;
  }

  #down(value: string, frame: SocketFrame | 'closed'): Effect.Effect<void> {
    return Effect.suspend(() =>
      Effect.asVoid(Queue.offer(Option.getOrThrow(Option.fromNullishOr(this.#downs.get(value))), frame)),
    );
  }
}

interface Answering {
  readonly answers: ReadonlyMap<string, ServiceAnswer>;
  readonly lateBy: ReadonlyMap<string, number>;
  readonly asked: (connection: string) => void;
}

function lateOn(lateBy: Answering['lateBy']) {
  return (connection: string) => {
    const by = lateBy.get(connection);
    return by === undefined ? Effect.void : TestClock.adjust(by);
  };
}

/**
 * The connections as a playbook reaches them, answering the HTTP request that asks who a connection is with the
 * connection's own user, by the connection's name, after the time it is late by on the test's clock. A tool is
 * asked as the connection, never as a playbook.
 */
export function answeringBy({ lateBy, asked }: Pick<Answering, 'lateBy' | 'asked'>): ThroughTheConnection {
  const late = lateOn(lateBy);
  return {
    callOnce: Function.constant(Effect.die('a tool was called as a playbook')),
    requestOnce: ({ server }) =>
      Effect.andThen(
        late(server),
        Effect.sync(() => {
          asked(server);
          return { kind: 'answered', outcome: 'result', answer: { self: { uid: `B-${server}` } } } as const;
        }),
      ),
    mostRequestBytesTo: () => 1_048_576,
  };
}

/**
 * The tools of the connections called as the connection itself, answering as told by the connection's id, after the
 * time it is late by on the test's clock.
 */
export function answeringAsTheConnection({ answers, lateBy, asked }: Answering): ConnectionWays {
  const late = lateOn(lateBy);
  return {
    callAsTheConnection: ({ connection }) =>
      Effect.andThen(
        late(connection),
        Effect.sync(() => {
          asked(connection);
          return answers.get(connection) ?? answeredWith({ self: { uid: `B-${connection}` } });
        }),
      ),
  };
}
