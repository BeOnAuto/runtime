import { SocketEnded, type OpensASocket, type SocketFrame, type SocketOpening } from '@on.auto/providers';
import { Effect, Option, Queue, Redacted } from 'effect';

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
