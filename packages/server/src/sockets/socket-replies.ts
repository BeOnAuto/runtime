import type {
  ConnectionWake,
  DeliveredReply,
  PlaybooksWaiting,
  ReplyAwaited,
  ReplyDelivery,
} from '@on.auto/interaction';
import type { PlaybookAddress } from '@on.auto/operations';
import { millisecondsSinceTheEpochOf, type ArrivalReading, type ProviderList } from '@on.auto/providers';
import { Effect, type Context } from 'effect';

import { replyStatusesOf, type StatusTools } from './reply-statuses.ts';
import type { SocketMember } from './socket-registries.ts';

export interface SocketReplies {
  readonly waitingIn: PlaybooksWaiting;
  readonly awaited: ReplyAwaited;
  readonly delivered: ReplyDelivery;
  readonly tools: StatusTools;
}

export interface ArrivalParts {
  readonly wake: ConnectionWake;
  readonly replies: SocketReplies;
}

interface RepliesTaking extends Pick<ArrivalParts, 'replies'> {
  readonly registries: { readonly providers: ProviderList };
  readonly context: Context.Context<never> | undefined;
}

type ReadReply = NonNullable<NonNullable<ArrivalReading['wake']>['reply']>;

export interface CarriedReply {
  readonly conversation: string;
  readonly reply: ReadReply;
  readonly now: number;
}

type Statuses = ReturnType<typeof replyStatusesOf>;

const replyWords = {
  untaken:
    'A reply that arrived over a socket could not be taken as it arrived, so the reading of its conversation takes it',
} as const;

function deliveredOf({ reply, now }: CarriedReply): DeliveredReply {
  const { id, sender, text, to, time } = reply;
  return { id, sender, text, to, time: millisecondsSinceTheEpochOf(time) ?? now };
}

interface Taking {
  readonly replies: SocketReplies;
  readonly statuses: Statuses;
  readonly member: SocketMember;
  readonly carried: CarriedReply;
}

function takenIn({ replies, statuses, member, carried }: Taking, playbook: PlaybookAddress): Effect.Effect<boolean> {
  const { conversation } = carried;
  const place = { playbook, connection: member.holder.name, conversation };
  const { id, sender, to } = carried.reply;
  return Effect.flatMap(replies.awaited(place, { id, sender, to }), ({ awaited, typing, party }) => {
    if (!awaited) {
      return Effect.succeed(false);
    }
    const shown =
      typing && party !== undefined
        ? statuses.shown({ member, playbook, conversation, reply: { id, to }, party })
        : Effect.void;
    return Effect.andThen(
      shown,
      Effect.map(replies.delivered({ ...place, replies: [deliveredOf(carried)] }, carried.now), (performed) =>
        performed.some(({ outcome }) => outcome !== 'unrecorded'),
      ),
    );
  });
}

function takenBy(replies: SocketReplies, statuses: Statuses) {
  return (member: SocketMember, carried: CarriedReply): Effect.Effect<boolean> => {
    const { org, holder } = member;
    if (holder.account !== carried.reply.account) {
      return Effect.succeed(false);
    }
    const taking = { replies, statuses, member, carried };
    return Effect.flatMap(replies.waitingIn(org, carried.conversation), (playbooks) =>
      Effect.map(
        Effect.forEach(playbooks, (playbook) => takenIn(taking, playbook)),
        (taken: readonly boolean[]) => taken.includes(true),
      ),
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.as(
          Effect.logWarning(replyWords.untaken, cause).pipe(
            Effect.annotateLogs({ org, connection: holder.connection }),
          ),
          false,
        ),
      ),
    );
  };
}

export function repliesTakenBy({ replies, registries, context }: RepliesTaking) {
  const statuses = replyStatusesOf({ tools: replies.tools, providers: registries.providers, context });
  return { taken: takenBy(replies, statuses), stop: statuses.stop };
}
