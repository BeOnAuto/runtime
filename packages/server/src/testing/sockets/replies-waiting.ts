import { clickDelivery, playbooksWaitingIn, replyAwaited, replyDelivery } from '@on.auto/interaction';
import {
  chatConversations,
  chatHarness,
  threadDocument,
  threadRepliesTelling,
  type ChatHarness,
} from '@on.auto/interaction/testing';
import type { CalledOnce } from '@on.auto/tool-servers';
import { Effect, Option } from 'effect';
import { vi } from 'vitest';

import type { StatusTools } from '../../sockets/reply-statuses.ts';
import type { SocketReplies } from '../../sockets/socket-replies.ts';
import { answeredWith } from './held-sockets.ts';

export const T0 = Date.parse('2026-11-22T09:00:00.000Z');

export const askedRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b91';

/** Seconds after T0, as a chat writes a message's id and time. */
export function secondsAfter(seconds: number): string {
  return `${T0 / 1000 + seconds}.000100`;
}

interface StatusAsked {
  readonly at: readonly [string, string, string];
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

interface Statuses {
  readonly tools: StatusTools;
  readonly asked: () => readonly StatusAsked[];
}

/** The tools a working status is shown through, answering each call in turn as given and showing it after them. */
export function statusesAnswering(...answers: readonly Effect.Effect<CalledOnce>[]): Statuses {
  const asked: StatusAsked[] = [];
  return {
    tools: {
      callOnce: ({ org, playbook, reference, input }) =>
        Effect.suspend(() => {
          asked.push({ at: [org, playbook, reference.server], tool: reference.tool, input });
          return answers[asked.length - 1] ?? Effect.succeed(answeredWith({ ok: true }));
        }),
      mostRequestBytesTo: () => 1_048_576,
    },
    asked: () => [...asked],
  };
}

export interface RepliesWaiting {
  readonly playbook: ChatHarness;
  readonly thread: string;
  readonly replies: SocketReplies;
  readonly statuses: Statuses;
}

/**
 * A request of the chat harness sent at T0 through the connection named chat, the reply branch of a server over its
 * ledger, and the tools that branch shows a working status through, answering as given. It fakes Date at T0 until the
 * test restores the timers.
 */
export async function repliesWaiting(...answers: readonly Effect.Effect<CalledOnce>[]): Promise<RepliesWaiting> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  const playbook = await chatHarness({
    conversations: chatConversations,
    document: threadDocument({ replies: threadRepliesTelling() }),
  });
  await playbook.askInThread(askedRun);
  await playbook.performDue(T0);
  const [request] = playbook.chat.posted();
  const ledger = playbook.ledger.service;
  const statuses = statusesAnswering(...answers);
  const replies = {
    waitingIn: playbooksWaitingIn({ ledger }),
    awaited: replyAwaited({ ledger }),
    delivered: replyDelivery({ ledger, tools: playbook.chat, record: playbook.record }),
    clicked: clickDelivery({ ledger, tools: playbook.chat, record: playbook.record }),
    tools: statuses.tools,
  };
  return { playbook, thread: Option.getOrThrow(Option.fromNullishOr(request)).ts, replies, statuses };
}
