import { addressOfTheRow, everyDefinitionOf, playbookRowsOf, type PlaybookProjectedRow } from '@on.auto/operations';
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
    reading: Schema.String,
    reply: Schema.fromJsonString(ReplyRuleSchema),
    answer_schema: Schema.fromJsonString(Schema.JsonObject),
  }),
);

const sentOfARead = Schema.decodeUnknownSync(Schema.Struct({ sent_id: Schema.String }));

export function takesReplies({ standing }: Pick<OpenRequestRow, 'standing'>): boolean {
  return takingReplies.has(standing);
}

export function keptRequestOf(placed: PlaybookProjectedRow, stored: OpenRequestRow): KeptRequest {
  const kept = keptRowFrom(stored);
  return {
    playbook: { org: placed.org, playbook: placed.playbook },
    address: addressOfTheRow(placed),
    runId: placed.key,
    row: stored,
    sent: { conversation: kept.sent_conversation, id: kept.sent_id },
    reading: kept.reading,
    rule: kept.reply,
    answerSchema: kept.answer_schema,
  };
}

function keptOf(placed: PlaybookProjectedRow): readonly KeptRequest[] {
  const stored = requestRowFrom(placed.row);
  return takesReplies(stored) ? [keptRequestOf(placed, stored)] : [];
}

export interface OpenInConversation {
  readonly kept: readonly KeptRequest[];
  readonly more: boolean;
}

export function endedRequestMessages(
  parts: { readonly ledger: Pick<ConversationParts['ledger'], 'readProjectedRows'> },
  { address, key }: Pick<ConversationPlace, 'address' | 'key'>,
): Effect.Effect<ReadonlySet<string>> {
  return Effect.map(
    parts.ledger.readProjectedRows(openRequestsName, everyDefinitionOf(address), {
      where: [
        { column: 'open', equals: false },
        { column: 'conversation', equals: key },
      ],
      orderBy: ['requested_at'],
      order: 'asc',
      limit: conversationBounds.requestsRead,
    }),
    (rows) => new Set(playbookRowsOf(openRequestsName, rows).map(({ row }) => sentOfARead(row).sent_id)),
  );
}

export function openInConversation(
  parts: { readonly ledger: Pick<ConversationParts['ledger'], 'readProjectedRows'> },
  { address, key }: Pick<ConversationPlace, 'address' | 'key'>,
): Effect.Effect<OpenInConversation> {
  return Effect.map(
    parts.ledger.readProjectedRows(openRequestsName, everyDefinitionOf(address), {
      where: [
        { column: 'open', equals: true },
        { column: 'conversation', equals: key },
      ],
      orderBy: ['requested_at'],
      order: 'asc',
      limit: conversationBounds.requestsRead,
    }),
    (rows) => ({
      kept: playbookRowsOf(openRequestsName, rows).flatMap((placed) => keptOf(placed)),
      more: rows.length === conversationBounds.requestsRead,
    }),
  );
}
