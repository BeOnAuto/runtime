import type {
  ClickDelivery,
  ConnectionWake,
  PerformedClick,
  DeliveredClick,
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
  readonly clicked: ClickDelivery;
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

type ReadClick = NonNullable<NonNullable<ArrivalReading['wake']>['click']>;

export interface CarriedClick {
  readonly conversation: string;
  readonly click: ReadClick;
  readonly now: number;
}

export interface CarriedReply {
  readonly conversation: string;
  readonly reply: ReadReply;
  readonly now: number;
}

type Statuses = ReturnType<typeof replyStatusesOf>;

const replyWords = {
  unclicked: 'A click that arrived over a socket could not be taken, and is lost',
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

function deliveredClickOf({ click, now }: CarriedClick): DeliveredClick {
  const { id, sender, to, action, time } = click;
  return { id, sender, to, action, time: millisecondsSinceTheEpochOf(time) ?? now };
}

type Verdict = Pick<PerformedClick, 'outcome' | 'because'>;

const notTakenWords: Readonly<Record<string, string>> = {
  account: 'A click that arrived over a socket is of another account than its connection, so it was not taken',
  nobody: 'A click that arrived over a socket is on a message no request waits on, so it was not taken',
  no_request:
    'A click that arrived over a socket is on a message no request of the playbook was sent as, so it was not taken',
  closed: 'A click that arrived over a socket is on a request that is answered or ended, so it was not taken',
  unrecorded: 'A click that arrived over a socket could not be recorded, so it was not taken',
};

function reasonOf({ outcome, because }: Verdict): string | undefined {
  if (outcome === 'unrecorded') {
    return 'unrecorded';
  }
  return because === 'no_request' || because === 'closed' ? because : undefined;
}

function notTaken(member: SocketMember, reason: string): Effect.Effect<void> {
  return Effect.logWarning(notTakenWords[reason]).pipe(
    Effect.annotateLogs({ org: member.org, connection: member.holder.connection, reason }),
  );
}

export function clickedBy(replies: SocketReplies) {
  return (member: SocketMember, carried: CarriedClick): Effect.Effect<void> => {
    const { org, holder } = member;
    if (holder.account !== carried.click.account) {
      return notTaken(member, 'account');
    }
    const { conversation } = carried;
    return Effect.flatMap(replies.waitingIn(org, conversation), (playbooks) =>
      playbooks.length === 0
        ? notTaken(member, 'nobody')
        : Effect.forEach(
            playbooks,
            (playbook) =>
              Effect.flatMap(
                replies.clicked(
                  { playbook, connection: holder.name, conversation, clicks: [deliveredClickOf(carried)] },
                  carried.now,
                ),
                (performed) =>
                  Effect.forEach(
                    performed.flatMap((each) => reasonOf(each) ?? []),
                    (reason) => notTaken(member, reason),
                    { discard: true },
                  ),
              ),
            { discard: true },
          ),
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning(replyWords.unclicked, cause).pipe(
          Effect.annotateLogs({ org, connection: holder.connection }),
        ),
      ),
    );
  };
}
