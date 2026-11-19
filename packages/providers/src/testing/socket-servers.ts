import { Clock, Effect, Logger, Option, Queue, Redacted, type Scope } from 'effect';
import { TestClock } from 'effect/testing';

import type { Destination } from '../events/destination-fields.ts';
import { receivingOverASocket, type SocketListening } from '../sockets/socket-listening.ts';
import {
  SocketEnded,
  type Arrived,
  type OpenSocket,
  type OpensASocket,
  type SocketArrival,
  type SocketFrame,
  type SocketOpening,
} from '../sockets/socket-ports.ts';

type Down = SocketFrame | { readonly kind: 'close'; readonly code?: number };

type ClosedBy = 'the service' | 'the runtime';

function closedWith(code: number | undefined): SocketEnded {
  return new SocketEnded(code === undefined ? { end: 'closed' } : { end: 'closed', code });
}

function frameOf(sent: Down): Effect.Effect<SocketFrame, SocketEnded> {
  return sent.kind === 'close' ? Effect.fail(closedWith(sent.code)) : Effect.succeed(sent);
}

class FakeSocketServer {
  readonly #attemptsAt: number[] = [];
  readonly #openedAt: number[] = [];
  readonly #credentials: Redacted.Redacted[] = [];
  readonly #failureCodes: SocketOpening['failureCodes'][] = [];
  readonly #received: string[] = [];
  readonly #downs: Queue.Queue<Down>[] = [];
  readonly #closedBy: (ClosedBy | undefined)[] = [];
  #refusals = 0;
  #refusesTheValue = false;
  #pings = 0;
  #hanging = false;

  readonly opens: OpensASocket = ({ credential, failureCodes }) =>
    Effect.flatMap(Clock.currentTimeMillis, (now): Effect.Effect<OpenSocket, SocketEnded, Scope.Scope> => {
      this.#attemptsAt.push(now);
      this.#credentials.push(credential);
      this.#failureCodes.push(failureCodes);
      if (this.#refusesTheValue) {
        return Effect.fail(new SocketEnded({ end: 'refused' }));
      }
      if (this.#refusals > 0) {
        this.#refusals -= 1;
        return Effect.fail(new SocketEnded({ end: 'not opened', host: 'socket.chat.example.com' }));
      }
      return this.#hanging ? Effect.never : this.#opened();
    });

  readonly sends = (text: string): Effect.Effect<void> => this.#down({ kind: 'message', text });

  readonly pongs: Effect.Effect<void> = Effect.suspend(() => this.#down({ kind: 'pong' }));

  readonly closes = (code?: number): Effect.Effect<void> =>
    Effect.suspend(() => {
      this.#closedBy[this.#closedBy.length - 1] = 'the service';
      return this.#down(code === undefined ? { kind: 'close' } : { kind: 'close', code });
    });

  get attemptsAt(): readonly number[] {
    return this.#attemptsAt;
  }

  get openedAt(): readonly number[] {
    return this.#openedAt;
  }

  get credentials(): readonly Redacted.Redacted[] {
    return this.#credentials;
  }

  get failureCodes(): readonly SocketOpening['failureCodes'][] {
    return this.#failureCodes;
  }

  get received(): readonly string[] {
    return this.#received;
  }

  readonly pinged = (): number => this.#pings;

  readonly closedBy = (): readonly (ClosedBy | undefined)[] => [...this.#closedBy];

  readonly refuse = (openings: number): void => {
    this.#refusals = openings;
  };

  readonly hang = (hanging: boolean): void => {
    this.#hanging = hanging;
  };

  readonly refuseTheValue = (refusing: boolean): void => {
    this.#refusesTheValue = refusing;
  };

  #opened(): Effect.Effect<OpenSocket, never, Scope.Scope> {
    return Effect.gen({ self: this }, function* () {
      const down = yield* Queue.unbounded<Down>();
      const socket = this.#downs.push(down) - 1;
      this.#closedBy.push(undefined);
      this.#openedAt.push(yield* Clock.currentTimeMillis);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          this.#closedBy[socket] ??= 'the runtime';
        }),
      );
      return this.#openOver(socket);
    });
  }

  #openOver(socket: number): OpenSocket {
    return {
      next: Effect.suspend(() => Effect.flatMap(Queue.take(this.#downAt(socket)), frameOf)),
      send: (text) => Effect.sync(() => this.#received.push(text)),
      ping: Effect.sync(() => {
        this.#pings += 1;
      }),
    };
  }

  #downAt(socket: number): Queue.Queue<Down> {
    return Option.getOrThrow(Option.fromNullishOr(this.#downs.at(socket)));
  }

  #down(sent: Down): Effect.Effect<void> {
    return Effect.suspend(() => Effect.asVoid(Queue.offer(this.#downAt(-1), sent)));
  }
}

export type Hearer = (record: (arrival: SocketArrival) => number) => Arrived;

export interface Heard {
  readonly server: FakeSocketServer;
  readonly arrivals: readonly SocketArrival[];
  readonly logged: readonly string[];
  readonly told: readonly string[];
}

export interface Setting {
  readonly refusals?: number;
  readonly refusesTheValue?: boolean;
  readonly hanging?: boolean;
  readonly hearer?: Hearer;
  readonly failureCodes?: SocketOpening['failureCodes'];
}

export interface Listened extends Setting {
  readonly destination: Destination;
  readonly credential: string;
  readonly hearer: Hearer;
}

export type Script = (server: FakeSocketServer) => Effect.Effect<void, never, Scope.Scope>;

export const settled = Effect.repeat(Effect.yieldNow, { times: 10 });

export function after(milliseconds: number): Effect.Effect<void> {
  return TestClock.adjust(milliseconds).pipe(Effect.andThen(settled));
}

function toldTo(tell: (said: string) => void): Pick<SocketListening, 'opened' | 'ended'> {
  return {
    opened: Effect.sync(() => {
      tell('opened');
    }),
    ended: (end) =>
      Effect.sync(() => {
        tell(end);
      }),
  };
}

export async function listenedOver(listened: Listened, script: Script): Promise<Heard> {
  const server = new FakeSocketServer();
  server.refuse(listened.refusals ?? 0);
  server.refuseTheValue(listened.refusesTheValue ?? false);
  server.hang(listened.hanging ?? false);
  const arrivals: SocketArrival[] = [];
  const logged: string[] = [];
  const told: string[] = [];
  const { destination, credential, hearer, failureCodes } = listened;
  const arrived = hearer((arrival) => arrivals.push(arrival));
  const listening = {
    destination,
    credential: Redacted.make(credential),
    opens: server.opens,
    arrived,
    ...(failureCodes === undefined ? {} : { failureCodes }),
    ...toldTo((said) => {
      told.push(said);
    }),
  };
  await Effect.runPromise(
    Effect.scoped(
      Effect.forkScoped(receivingOverASocket(listening)).pipe(Effect.andThen(settled), Effect.andThen(script(server))),
    ).pipe(
      Effect.provide(TestClock.layer()),
      Effect.provide(Logger.layer([Logger.map(Logger.formatJson, (line) => logged.push(line))])),
    ),
  );
  return { server, arrivals, logged, told };
}
