import { Effect, Schema } from 'effect';

import {
  replyDelivery,
  type DeliveredReplies,
  type DeliveredReply,
  type PerformedReply,
} from '../wakes/delivered-replies.ts';
import { chatConversations } from './chat-conversations.ts';
import { answererId, chatHarness, type ChatHarness, type ChatHarnessOptions } from './chat-harness.ts';
import { threadDocument, threadRepliesTelling } from './documents.ts';
import { alpha } from './interaction-harness.ts';
import { theChannel } from './woken-conversations.ts';

export const askedRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7d';

export const throughTheProvider: ChatHarnessOptions = {
  conversations: chatConversations,
  document: threadDocument({ replies: threadRepliesTelling() }),
};

const firstPosted = Schema.decodeUnknownSync(Schema.NonEmptyArray(Schema.Struct({ ts: Schema.String })));

export interface Delivering {
  readonly playbook: ChatHarness;
  readonly thread: string;
  readonly lastPosted: () => string;
  readonly written: (text: string, writer?: string, thread?: string) => DeliveredReply;
  readonly delivered: (
    replies: readonly DeliveredReply[],
    now?: number,
    place?: Partial<Omit<DeliveredReplies, 'replies'>>,
  ) => Promise<readonly PerformedReply[]>;
  readonly lines: () => readonly (readonly [string | undefined, string | undefined])[];
}

export async function deliveringTo(options: ChatHarnessOptions = throughTheProvider): Promise<Delivering> {
  const playbook = await chatHarness(options);
  await playbook.askInThread(askedRun);
  await playbook.performDue(Date.now());
  const [{ ts: thread }] = firstPosted(playbook.chat.posted());
  const delivery = replyDelivery({ ledger: playbook.ledger.service, tools: playbook.chat, record: playbook.record });
  const clock = { written: Date.now() };
  return {
    playbook,
    thread,
    lastPosted: () => firstPosted(playbook.chat.posted().toReversed())[0].ts,
    written: (text, writer = answererId, inThread = thread) => {
      clock.written += 1000;
      const id = playbook.chat.reply({ channel: theChannel, thread: inThread, user: writer, text });
      return { id, sender: writer, text, to: inThread, time: clock.written };
    },
    delivered: (replies, now = Date.now(), place = {}) =>
      Effect.runPromise(
        delivery({ playbook: alpha, connection: 'chat', conversation: theChannel, ...place, replies }, now),
      ),
    lines: () =>
      playbook.chat
        .posted()
        .slice(1)
        .map(({ thread_ts: inThread, text }) => [inThread, text] as const),
  };
}
