import type { ChatMessage } from '@on.auto/providers';
import { background } from '@on.auto/workflow-host';
import { Context, Effect } from 'effect';

import type { ChatOfEachServing, ChatOfTheSockets } from '../../sockets/served-sockets.ts';
import type { SocketMember } from '../../sockets/socket-registries.ts';
import type { Arrival } from '../tables/chat-rows.ts';
import type { ChatConnection, ChatServing, ServingNow } from './arrival-parts.ts';
import { claimOf, routeOf } from './arrival-routing.ts';
import { arrivalTaken, restartTold, type Outcome } from './chat-arrivals.ts';
import { leaseHolders } from './lease-holders.ts';

export interface ChatSocketParts {
  readonly serving: ChatServing;
  readonly connectionOf: (member: SocketMember) => Promise<ChatConnection | undefined>;
}

const chatWords = {
  taken: 'A message a person wrote to Auto was answered',
  failed: 'A message a person wrote to Auto could not be answered',
  unread: 'The messages a restart left unanswered could not be read',
  unrenewed: 'Auto could not show again that it is working on a message; the turn goes on without it',
} as const;

type Turn = () => Promise<Outcome>;

function tiedOf(members: readonly SocketMember[], { account }: ChatMessage): SocketMember | undefined {
  return members
    .filter(({ holder }) => account !== undefined && holder.account === account)
    .toSorted((left, right) => left.holder.connection.localeCompare(right.holder.connection))
    .at(0);
}

function arrivalOf({ holder }: SocketMember, { conversation, id, kind }: ChatMessage, account: string): Arrival {
  return { connection: holder.connection, account, conversation, message: id, kind };
}

function logged(member: SocketMember, outcome: Effect.Effect<Outcome>): Effect.Effect<void> {
  return outcome.pipe(
    Effect.flatMap((said) => Effect.logInfo(chatWords.taken).pipe(Effect.annotateLogs({ outcome: said }))),
    Effect.catchCause((cause) => Effect.logWarning(chatWords.failed, cause)),
    Effect.annotateLogs({ org: member.org, connection: member.holder.connection }),
  );
}

async function turnOf(
  { connectionOf }: ChatSocketParts,
  serving: ServingNow,
  member: SocketMember,
  message: ChatMessage,
): Promise<Turn | undefined> {
  const connection = await connectionOf(member);
  if (connection === undefined || (await routeOf(message, connection, serving.store)) === 'passed') {
    return undefined;
  }
  const arrival = arrivalOf(member, message, connection.account);
  return (await claimOf(arrival, serving.store)) === 'run'
    ? () => arrivalTaken({ message, connection, arrival }, serving)
    : undefined;
}

async function restartedAt(parts: ChatSocketParts, members: readonly SocketMember[]): Promise<void> {
  const { store } = parts.serving;
  const unsettled = await store.arrivals.unsettled();
  await Promise.all(
    unsettled.map(async (arrival) => {
      const member = members.find(({ holder }) => holder.connection === arrival.connection);
      const connection = member === undefined ? undefined : await parts.connectionOf(member);
      return restartTold(arrival, connection, store);
    }),
  );
}

function servedOnce(parts: ChatSocketParts, context: Context.Context<never> | undefined): ChatOfTheSockets {
  const turns = background(context);
  const stopping = new AbortController();
  const forked = Effect.runForkWith(context ?? Context.empty());
  const serving: ServingNow = {
    ...parts.serving,
    signal: stopping.signal,
    holders: leaseHolders(),
    renewalFailed: (cause) => {
      forked(Effect.logWarning(chatWords.unrenewed, cause));
    },
  };
  const restarted = { once: false };
  const run = (member: SocketMember, message: ChatMessage) => (turn: Turn | undefined) =>
    Effect.sync(() => {
      if (turn !== undefined) {
        const key = JSON.stringify([member.holder.connection, message.conversation, message.id, message.kind]);
        turns.run(key, logged(member, Effect.promise(turn)));
      }
    });
  return {
    arrived: (members, message) => {
      const member = message === undefined ? undefined : tiedOf(members, message);
      return message === undefined || member === undefined
        ? Effect.void
        : Effect.promise(() => turnOf(parts, serving, member, message)).pipe(
            Effect.flatMap(run(member, message)),
            Effect.catchCause((cause) => logged(member, Effect.failCause(cause))),
          );
    },
    restarted: (members) => {
      const first = !restarted.once;
      restarted.once = true;
      return first
        ? Effect.promise(() => restartedAt(parts, members)).pipe(
            Effect.catchCause((cause) => Effect.logWarning(chatWords.unread, cause)),
          )
        : Effect.void;
    },
    stop: () =>
      Effect.andThen(
        Effect.sync(() => {
          stopping.abort();
        }),
        turns.stop(),
      ),
  };
}

export function chatSocketsOf(parts: ChatSocketParts, context?: Context.Context<never>): ChatOfEachServing {
  return { served: () => servedOnce(parts, context) };
}
