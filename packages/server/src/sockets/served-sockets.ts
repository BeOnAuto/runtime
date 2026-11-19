import { appCredentialRefused, connectionsStream } from '@on.auto/connections';
import type { ConnectionWake } from '@on.auto/interaction';
import type { StreamSignal } from '@on.auto/ledger';
import { orgOfStreamPrefix } from '@on.auto/operations';
import {
  receivingOverASocket,
  socketStepsOf,
  stillRefused,
  type OpensASocket,
  type SocketEnd,
  type SocketListening,
} from '@on.auto/providers';
import { background, oneWakeAtATime, type HostWakeUp, type WakeSignal } from '@on.auto/workflow-host';
import { Clock, Effect, Option, type Context } from 'effect';

import {
  memberKeyOf,
  registriesOf,
  type RegistryParts,
  type SocketMember,
  type WantedSocket,
} from './socket-registries.ts';

export interface SocketParts extends RegistryParts {
  readonly opens: OpensASocket;
  readonly wake: ConnectionWake;
  readonly appended: StreamSignal;
  readonly context: Context.Context<never> | undefined;
  readonly roundEveryMs?: number;
  readonly wakesApartMs?: number;
}

const socketTimes = { roundEveryMs: 60_000, wakesApartMs: 1000 } as const;

const servedWords = {
  unread: 'The registries of the connections could not be read for their sockets; the next round reads them again',
  unwoken: 'The conversations waiting through a connection a socket serves could not be made due',
} as const;

export function isARegistry(stream: string): boolean {
  return (
    stream.endsWith(`/${connectionsStream}`) &&
    Option.isSome(orgOfStreamPrefix(stream.slice(0, -connectionsStream.length)))
  );
}

function membersOf({ members }: WantedSocket): readonly string[] {
  return members.map((member) => memberKeyOf(member)).toSorted();
}

interface Held {
  readonly current: () => WantedSocket;
  readonly regrouped: (wanted: WantedSocket) => void;
}

function heldAs(first: WantedSocket): Held {
  const holding = { wanted: first };
  return {
    current: () => holding.wanted,
    regrouped: (wanted) => {
      holding.wanted = wanted;
    },
  };
}

class SocketSet {
  readonly #parts: SocketParts;
  readonly #registries: ReturnType<typeof registriesOf>;
  readonly #sockets: ReturnType<typeof background>;
  readonly #running = new Map<string, Held>();
  readonly #wokenAt = new Map<string, number>();
  #refused: ReadonlySet<string> = new Set();

  constructor(parts: SocketParts) {
    this.#parts = parts;
    this.#registries = registriesOf(parts);
    this.#sockets = background(parts.context);
  }

  get #apartMs(): number {
    return this.#parts.wakesApartMs ?? socketTimes.wakesApartMs;
  }

  readonly round: Effect.Effect<void, unknown> = Effect.gen({ self: this }, function* () {
    const wanted = yield* this.#registries.wanted;
    this.#refused = stillRefused(this.#refused, wanted);
    const steps = socketStepsOf({
      wanted: new Map([...wanted.values()].map((each) => [each.key, membersOf(each)] as const)),
      running: new Map(
        [...this.#running.values()].map((held) => [held.current().key, membersOf(held.current())] as const),
      ),
      refused: this.#refused,
    });
    for (const key of steps.close) {
      this.#running.delete(key);
      yield* this.#sockets.interrupt(key);
    }
    const opened = new Set(steps.open);
    const regrouped = new Set(steps.regroup);
    for (const each of wanted.values()) {
      if (opened.has(each.key)) {
        this.#started(each);
      } else if (regrouped.has(each.key)) {
        Option.getOrThrow(Option.fromNullishOr(this.#running.get(each.key))).regrouped(each);
      }
    }
    yield* this.#forgetWakesBefore(yield* Clock.currentTimeMillis);
  });

  readonly stop = (): Effect.Effect<void> => this.#sockets.stop();

  #started(wanted: WantedSocket): void {
    const held = heldAs(wanted);
    this.#running.set(wanted.key, held);
    const ended = Effect.sync(() => {
      this.#running.delete(wanted.key);
    });
    this.#sockets.run(
      wanted.key,
      receivingOverASocket(this.#listeningOf(held)).pipe(
        Effect.annotateLogs({ provider: wanted.provider, connections: wanted.members.length }),
        Effect.ensuring(ended),
      ),
    );
  }

  #listeningOf(held: Held): SocketListening {
    const members = () => held.current().members;
    return {
      ...held.current().opening,
      opens: this.#parts.opens,
      arrived: ({ reading }) => {
        const conversation = reading.wake?.conversation;
        return conversation === undefined ? Effect.void : this.#wokenEach(members(), conversation);
      },
      opened: Effect.suspend(() => this.#wokenEach(members())),
      ended: (end) => this.#endedAs(held.current(), end),
    };
  }

  #endedAs({ key, members }: WantedSocket, end: SocketEnd): Effect.Effect<void> {
    if (end !== 'refused') {
      return Effect.void;
    }
    this.#refused = new Set([...this.#refused, key]);
    return Effect.forEach(members, ({ org, holder }) => appCredentialRefused(this.#parts.registries, org, holder), {
      discard: true,
    });
  }

  #wokenEach(members: readonly SocketMember[], conversation?: string): Effect.Effect<void> {
    return Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.forEach(members, (member) => this.#wokenOnce(member, now, conversation), { discard: true }),
    ).pipe(Effect.catchCause((cause) => Effect.logWarning(servedWords.unwoken, cause)));
  }

  #wokenOnce({ org, holder }: SocketMember, now: number, conversation: string | undefined): Effect.Effect<void> {
    const key = JSON.stringify([org, holder.name, conversation ?? null]);
    const last = this.#wokenAt.get(key);
    if (last !== undefined && now - last < this.#apartMs) {
      return Effect.void;
    }
    this.#wokenAt.set(key, now);
    const place = conversation === undefined ? {} : { conversation };
    return this.#parts.wake({ org, connection: holder.name, ...place }, now);
  }

  #forgetWakesBefore(now: number): Effect.Effect<void> {
    return Effect.sync(() => {
      for (const [key, at] of this.#wokenAt) {
        if (at < now - this.#apartMs) {
          this.#wokenAt.delete(key);
        }
      }
    });
  }
}

export function socketWakeUpOf(parts: SocketParts): (signal: WakeSignal) => HostWakeUp {
  return (signal) => {
    const sockets = new SocketSet(parts);
    const due = { at: Number.NEGATIVE_INFINITY, signalled: false };
    const stopListening = parts.appended.listen((stream) => {
      if (isARegistry(stream)) {
        due.signalled = true;
        signal.raised();
      }
    });
    const roundEveryMs = parts.roundEveryMs ?? socketTimes.roundEveryMs;
    return {
      wakeUp: oneWakeAtATime(({ now }) =>
        Effect.gen(function* () {
          signal.renewed();
          if (due.signalled || now >= due.at) {
            due.signalled = false;
            due.at = now + roundEveryMs;
            yield* sockets.round.pipe(Effect.catchCause((cause) => Effect.logWarning(servedWords.unread, cause)));
          }
          return { nextDueAt: due.at };
        }),
      ),
      stop: () =>
        Effect.andThen(
          Effect.sync(() => {
            stopListening();
          }),
          sockets.stop(),
        ),
    };
  };
}
