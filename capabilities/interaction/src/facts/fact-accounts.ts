import { cutAtCodePoint, issuesShown, mostNameBytes } from '@on.auto/definitions';
import type { KeptContent, PresentedFact } from '@on.auto/operations';
import { callFieldsShown, keptAnswerOf, keptArgumentsOf } from '@on.auto/tool-servers';
import type { Schema } from 'effect';

import type { DeliveredAs, RepliesIn } from '../tool-blocks/tool-block-schemas.ts';
import { deliveryEnded, deliveryStarted, replyRefused } from './fact-words.ts';
import type { RecordedFactNamed } from './run-facts.ts';

function named(text: string): string {
  return cutAtCodePoint(text, mostNameBytes);
}

function deliveredAsShown(deliveredAs: DeliveredAs | undefined) {
  return deliveredAs === undefined
    ? {}
    : { delivered_as: { conversation: named(deliveredAs.conversation), id: named(deliveredAs.id) } };
}

function repliesInShown(repliesIn: RepliesIn | undefined) {
  return repliesIn === undefined
    ? {}
    : { replies_in: { server: named(repliesIn.server), tool: named(repliesIn.tool), key: named(repliesIn.key) } };
}

export function startedAccount(event: RecordedFactNamed<'delivery_started'>, content: KeptContent): PresentedFact {
  const { data } = event;
  return {
    type: event.type,
    summary: deliveryStarted(event),
    data: { ...callFieldsShown(data), target: named(data.target), ...keptArgumentsOf(data, content) },
  };
}

export function succeededAccount(event: RecordedFactNamed<'delivery_succeeded'>, content: KeptContent): PresentedFact {
  const { data } = event;
  return {
    type: event.type,
    summary: deliveryEnded(event),
    data: {
      ...callFieldsShown(data),
      ...deliveredAsShown(data.delivered_as),
      ...repliesInShown(data.replies_in),
      ...keptAnswerOf(data, content),
    },
  };
}

export function failedAccount(event: RecordedFactNamed<'delivery_failed'>, content: KeptContent): PresentedFact {
  const { data } = event;
  return {
    type: event.type,
    summary: deliveryEnded(event),
    data: { ...callFieldsShown(data), ...keptAnswerOf(data, content) },
  };
}

export function refusedAccount(event: RecordedFactNamed<'delivery_refused'>): PresentedFact {
  return { type: event.type, summary: deliveryEnded(event), data: callFieldsShown(event.data) };
}

export function replyRefusedAccount(event: RecordedFactNamed<'reply_refused'>): PresentedFact {
  const { server, tool, reply, because, issues, told } = event.data;
  const data: Readonly<Record<string, Schema.Json>> = {
    server: named(server),
    tool: named(tool),
    reply: { id: named(reply.id), sender: named(reply.sender) },
    because,
    told,
    ...(issues === undefined ? {} : issuesShown(issues)),
  };
  return { type: event.type, summary: replyRefused(event), data };
}
