import { Effect, Schema } from 'effect';

import { ReplyRuleSchema } from '../replies/reply-rule.ts';
import type { KeptRequest } from '../replies/reply-taking.ts';
import { openRequestsName } from '../requests/open-requests.ts';
import { requestRowFrom, type OpenRequestRow } from '../requests/request-rows.ts';
import type { ConversationParts, ConversationPlace } from './conversation-parts.ts';

const conversationBounds = { requestsRead: 100 } as const;

const takingReplies: ReadonlySet<string> = new Set(['delivered', 'retrying']);

const keptRowFrom = Schema.decodeUnknownSync(
  Schema.Struct({
    sent_conversation: Schema.String,
    sent_id: Schema.String,
    reply: Schema.fromJsonString(ReplyRuleSchema),
    answer_schema: Schema.fromJsonString(Schema.JsonObject),
  }),
);

function keptOf(runId: string, stored: OpenRequestRow): readonly KeptRequest[] {
  if (!takingReplies.has(stored.standing)) {
    return [];
  }
  const kept = keptRowFrom(stored);
  const sent = { conversation: kept.sent_conversation, id: kept.sent_id };
  return [{ runId, row: stored, sent, rule: kept.reply, answerSchema: kept.answer_schema }];
}

export interface OpenInConversation {
  readonly kept: readonly KeptRequest[];
  readonly more: boolean;
}

export function openInConversation(
  parts: { readonly ledger: Pick<ConversationParts['ledger'], 'readProjectedRows'> },
  { playbook, key }: Pick<ConversationPlace, 'playbook' | 'key'>,
): Effect.Effect<OpenInConversation> {
  return Effect.map(
    parts.ledger.readProjectedRows(openRequestsName, playbook, {
      where: [
        { column: 'open', equals: true },
        { column: 'conversation', equals: key },
      ],
      orderBy: ['requested_at'],
      order: 'asc',
      limit: conversationBounds.requestsRead,
    }),
    (rows) => ({
      kept: rows.flatMap(({ key: runId, row: stored }) => keptOf(runId, requestRowFrom(stored))),
      more: rows.length === conversationBounds.requestsRead,
    }),
  );
}
