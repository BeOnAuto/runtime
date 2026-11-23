import type { StreamReader } from '@on.auto/operations';
import { activePlaybooksOf } from '@on.auto/playbooks';
import {
  asksATool,
  isLasting,
  providerFoundBy,
  type LoopConnection,
  type OwedAsTheConnection,
  type ProviderList,
  type SubscriptionCallFailed,
} from '@on.auto/providers';
import { Effect } from 'effect';

import type { IdentitiesReading } from '../subscriptions/served-subscriptions.ts';
import type { SocketMember } from './socket-registries.ts';

export interface IdentityParts {
  readonly registry: Pick<StreamReader, 'load'>;
  readonly providers: ProviderList;
  readonly identities: IdentitiesReading;
}

type Failed = Pick<SubscriptionCallFailed, 'kind' | 'because'>;

interface Owed {
  readonly connection: LoopConnection;
  readonly member: SocketMember;
}

interface OwedHere {
  readonly owed: OwedAsTheConnection;
  readonly member: SocketMember;
}

interface HeldBack {
  readonly member: SocketMember;
  readonly failed: Failed;
}

const identityWords = {
  heldBack:
    'The service did not answer which account a connection of a socket is, so no event over the socket reaches it until it is connected again',
} as const;

function heldKeyOf({ org, holder }: SocketMember): string {
  return JSON.stringify([org, holder.connection, holder.connectedAt]);
}

function owingByOrg(members: readonly SocketMember[]): ReadonlyMap<string, ReadonlyMap<string, SocketMember>> {
  const byOrg = new Map<string, Map<string, SocketMember>>();
  for (const member of members) {
    const owing = byOrg.get(member.org) ?? new Map<string, SocketMember>();
    byOrg.set(member.org, owing.set(member.holder.connection, member));
  }
  return byOrg;
}

function owedAsTheConnectionBy(providers: ProviderList, member: SocketMember): readonly OwedHere[] {
  const { connection, name, connectedAt, provider } = member.holder;
  const identity = providerFoundBy(providers, provider)?.entry.events?.identity;
  return asksATool(identity)
    ? [{ owed: { id: connection, connection: name, connected: connectedAt, identify: identity }, member }]
    : [];
}

function unaskedAmong(
  owing: ReadonlyMap<string, SocketMember>,
  asked: readonly OwedAsTheConnection[],
): ReadonlyMap<string, SocketMember> {
  const left = new Map(owing);
  for (const { id } of asked) {
    left.delete(id);
  }
  return left;
}

function owedAmong(
  served: readonly LoopConnection[],
  owing: ReadonlyMap<string, SocketMember>,
  tried: ReadonlySet<string>,
): readonly Owed[] {
  return served.flatMap((connection) => {
    const member = owing.get(connection.id);
    return member === undefined || tried.has(connection.id) ? [] : [{ connection, member }];
  });
}

function heldBackAmong(members: readonly SocketMember[], unread: ReadonlyMap<string, Failed>): readonly HeldBack[] {
  return members.flatMap((member) => {
    const failed = unread.get(member.holder.name);
    return failed === undefined || !isLasting(failed.kind) ? [] : [{ member, failed }];
  });
}

function loggedOnce({ member: { org, holder }, failed }: HeldBack): Effect.Effect<void> {
  return Effect.logWarning(identityWords.heldBack).pipe(
    Effect.annotateLogs({ org, connection: holder.connection, kind: failed.kind, because: failed.because }),
  );
}

class OwedIdentities {
  readonly #parts: IdentityParts;
  #heldBack: ReadonlySet<string> = new Set();

  constructor(parts: IdentityParts) {
    this.#parts = parts;
  }

  readonly read = (members: readonly SocketMember[], deadline: number): Effect.Effect<void> =>
    Effect.gen({ self: this }, function* () {
      const owing = members.filter(({ holder }) => holder.identityOwed);
      const owed = new Set(owing.map((member) => heldKeyOf(member)));
      this.#heldBack = new Set([...this.#heldBack].filter((key) => owed.has(key)));
      const unheld = owing.filter((member) => !this.#heldBack.has(heldKeyOf(member)));
      for (const [org, byConnection] of owingByOrg(unheld)) {
        if (yield* this.#readIn(org, byConnection, deadline)) {
          return;
        }
      }
    });

  #readIn(org: string, owing: ReadonlyMap<string, SocketMember>, deadline: number): Effect.Effect<boolean> {
    return Effect.gen({ self: this }, function* () {
      const asTheConnection = [...owing.values()].flatMap((member) =>
        owedAsTheConnectionBy(this.#parts.providers, member),
      );
      const owedThere = asTheConnection.map(({ owed }) => owed);
      const { unread, cutAt } = yield* this.#parts.identities.readAsTheConnection(org, owedThere, deadline);
      yield* this.#heldBackOf(
        heldBackAmong(
          asTheConnection.map(({ member }) => member),
          unread,
        ),
      );
      if (cutAt !== undefined) {
        return true;
      }
      const throughAPlaybook = unaskedAmong(owing, owedThere);
      return throughAPlaybook.size > 0 && (yield* this.#readThroughPlaybooks(org, throughAPlaybook, deadline));
    });
  }

  #readThroughPlaybooks(
    org: string,
    owing: ReadonlyMap<string, SocketMember>,
    deadline: number,
  ): Effect.Effect<boolean> {
    return Effect.gen({ self: this }, function* () {
      let tried: ReadonlySet<string> = new Set();
      for (const playbook of yield* activePlaybooksOf(this.#parts.registry, { org })) {
        if (tried.size === owing.size) {
          return false;
        }
        const owed = owedAmong(yield* this.#parts.identities.connectionsOf(playbook), owing, tried);
        const connections = owed.map(({ connection }) => connection);
        tried = new Set([...tried, ...connections.map(({ id }) => id)]);
        const { unread, cutAt } = yield* this.#parts.identities.read(playbook, connections, deadline);
        yield* this.#heldBackOf(
          heldBackAmong(
            owed.map(({ member }) => member),
            unread,
          ),
        );
        if (cutAt !== undefined) {
          return true;
        }
      }
      return false;
    });
  }

  #heldBackOf(held: readonly HeldBack[]): Effect.Effect<void> {
    this.#heldBack = new Set([...this.#heldBack, ...held.map(({ member }) => heldKeyOf(member))]);
    return Effect.forEach(held, loggedOnce, { discard: true });
  }
}

export function owedIdentitiesOf(parts: IdentityParts): OwedIdentities {
  return new OwedIdentities(parts);
}
