import { appCredentialRefused, connectionsStream } from '@on.auto/connections';
import type { StreamSignal } from '@on.auto/ledger';
import { orgOfStreamPrefix } from '@on.auto/operations';
import { activePlaybooksOf } from '@on.auto/playbooks';
import {
  receivingOverASocket,
  socketStepsOf,
  stillRefused,
  type ArrivalReading,
  type OpensASocket,
  type SocketEnd,
  type SocketListening,
} from '@on.auto/providers';
import { background, oneWakeAtATime, type HostWakeUp, type TakeIn, type WakeSignal } from '@on.auto/workflow-host';
import { Clock, Effect, Option, type Context } from 'effect';

import { owedIdentitiesOf, type IdentityParts } from './socket-identities.ts';
import {
  memberKeyOf,
  registriesOf,
  type RegistryParts,
  type SocketMember,
  type WantedSocket,
} from './socket-registries.ts';
import { replyTakenBy, type CarriedReply, type ArrivalParts } from './socket-replies.ts';

type ArrivalEvent = NonNullable<ArrivalReading['event']>;

export interface SocketParts extends RegistryParts, ArrivalParts {
  readonly opens: OpensASocket;
  readonly takeIn: TakeIn;
  readonly identities: IdentityParts['identities'];
  readonly appended: StreamSignal;
  readonly context: Context.Context<never> | undefined;
  readonly roundEveryMs?: number;
  readonly wakesApartMs?: number;
}

const socketTimes = { roundEveryMs: 60_000, wakesApartMs: 1000 } as const;

function roundEveryMsOf({ roundEveryMs = socketTimes.roundEveryMs }: Pick<SocketParts, 'roundEveryMs'>): number {
  return roundEveryMs;
}

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
  readonly #owed: ReturnType<typeof owedIdentitiesOf>;
  readonly #replyTaken: ReturnType<typeof replyTakenBy>;
  readonly #sockets: ReturnType<typeof background>;
  readonly #running = new Map<string, Held>();
  readonly #wokenAt = new Map<string, number>();
  #refused: ReadonlySet<string> = new Set();

  constructor(parts: SocketParts) {
    this.#parts = parts;
    this.#registries = registriesOf(parts);
    this.#owed = owedIdentitiesOf({ registry: parts.registries.registry, identities: parts.identities });
    this.#replyTaken = replyTakenBy(parts.replies);
    this.#sockets = background(parts.context);
  }

  get #apartMs(): number {
    return this.#parts.wakesApartMs ?? socketTimes.wakesApartMs;
  }

  get #roundMs(): number {
    return roundEveryMsOf(this.#parts);
  }

  readonly round: Effect.Effect<void, unknown> = Effect.gen({ self: this }, function* () {
    const startedAt = yield* Clock.currentTimeMillis;
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
    const members = [...wanted.values()].flatMap((each) => each.members);
    yield* this.#owed.read(members, startedAt + this.#roundMs);
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
        const present = members();
        return Effect.andThen(this.#repliedOrWoken(present, reading), this.#takenIn(present, reading));
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

  #repliedOrWoken(members: readonly SocketMember[], { wake }: ArrivalReading): Effect.Effect<void> {
    if (wake?.conversation === undefined) {
      return Effect.void;
    }
    const { conversation, reply } = wake;
    if (reply === undefined) {
      return this.#wokenEach(members, conversation);
    }
    return Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.flatMap(this.#untakenBy(members, { conversation, reply, now }), (untaken) =>
        this.#wokenEach(untaken, conversation),
      ),
    );
  }

  #untakenBy(members: readonly SocketMember[], carried: CarriedReply): Effect.Effect<readonly SocketMember[]> {
    return Effect.filter(members, (member) => Effect.map(this.#replyTaken(member, carried), (taken) => !taken));
  }

  #takenIn(members: readonly SocketMember[], { event, connection }: ArrivalReading): Effect.Effect<void> {
    const account = connection?.account;
    if (event === undefined || account === undefined) {
      return Effect.void;
    }
    const tied = members.filter(({ holder }) => holder.account === account);
    return Effect.forEach(tied, (member) => this.#offeredTo(member, event), { discard: true });
  }

  #offeredTo({ org, holder }: SocketMember, event: ArrivalEvent): Effect.Effect<void> {
    return Effect.flatMap(activePlaybooksOf(this.#parts.registries.registry, { org }), (playbooks) =>
      Effect.forEach(
        playbooks,
        (playbook) => Effect.orDie(this.#parts.takeIn({ playbook, connection: holder.name, event })),
        { discard: true },
      ),
    );
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
    const roundEveryMs = roundEveryMsOf(parts);
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
