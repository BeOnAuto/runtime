import type {
  ConnectionWake,
  DeliveredReply,
  PlaybooksWaiting,
  ReplyAwaited,
  ReplyDelivery,
} from '@on.auto/interaction';
import type { PlaybookAddress } from '@on.auto/operations';
import { millisecondsSinceTheEpochOf, type ArrivalReading } from '@on.auto/providers';
import { Effect } from 'effect';

import type { SocketMember } from './socket-registries.ts';

export interface SocketReplies {
  readonly waitingIn: PlaybooksWaiting;
  readonly awaited: ReplyAwaited;
  readonly delivered: ReplyDelivery;
}

export interface ArrivalParts {
  readonly wake: ConnectionWake;
  readonly replies: SocketReplies;
}

type ReadReply = NonNullable<NonNullable<ArrivalReading['wake']>['reply']>;

export interface CarriedReply {
  readonly conversation: string;
  readonly reply: ReadReply;
  readonly now: number;
}

const replyWords = {
  untaken:
    'A reply that arrived over a socket could not be taken as it arrived, so the reading of its conversation takes it',
} as const;

function deliveredOf({ reply, now }: CarriedReply): DeliveredReply {
  const { id, sender, text, to, time } = reply;
  return { id, sender, text, to, time: millisecondsSinceTheEpochOf(time) ?? now };
}

function takenIn(
  replies: SocketReplies,
  { holder }: SocketMember,
  carried: CarriedReply,
  playbook: PlaybookAddress,
): Effect.Effect<boolean> {
  const place = { playbook, connection: holder.name, conversation: carried.conversation };
  const { id, sender, to } = carried.reply;
  return Effect.flatMap(replies.awaited(place, { id, sender, to }), ({ awaited }) =>
    awaited
      ? Effect.map(replies.delivered({ ...place, replies: [deliveredOf(carried)] }, carried.now), (performed) =>
          performed.some(({ outcome }) => outcome !== 'unrecorded'),
        )
      : Effect.succeed(false),
  );
}

export function replyTakenBy(
  replies: SocketReplies,
): (member: SocketMember, carried: CarriedReply) => Effect.Effect<boolean> {
  return (member, carried) => {
    const { org, holder } = member;
    if (holder.account !== carried.reply.account) {
      return Effect.succeed(false);
    }
    return Effect.flatMap(replies.waitingIn(org, carried.conversation), (playbooks) =>
      Effect.map(
        Effect.forEach(playbooks, (playbook) => takenIn(replies, member, carried, playbook)),
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
