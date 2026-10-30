import type { RecordWork } from '@on.auto/definitions';
import type { PlaybookAddress, ProjectionAdvancer, ProjectionReader } from '@on.auto/operations';
import type { ToolAccess } from '@on.auto/tool-servers';
import type { Effect } from 'effect';

import type { RequestLedger } from '../schedule/request-ledger.ts';
import type { Replies } from '../tool-blocks/tool-block-schemas.ts';
import { advancedOf, conversationsName, type Cadence, type ConversationRow } from './conversation-rows.ts';

export interface ConversationLedger
  extends RequestLedger, Pick<ProjectionReader, 'readProjectedRows'>, ProjectionAdvancer {}

export interface ConversationParts {
  readonly ledger: ConversationLedger;
  readonly tools: Pick<ToolAccess, 'preparedCall'>;
  readonly record: RecordWork;
}

export interface ConversationPlace {
  readonly playbook: PlaybookAddress;
  readonly key: string;
  readonly row: ConversationRow;
}

export interface ReadingRoute {
  readonly server: string;
  readonly delivering: string;
  readonly replies: Replies;
}

export function advanced(
  parts: ConversationParts,
  { playbook, key, row }: ConversationPlace,
  cadence: Cadence,
): Effect.Effect<void> {
  return parts.ledger.advanceRow(conversationsName, playbook, key, {
    set: advancedOf(cadence),
    when: [{ column: 'joined_by', equals: row.joined_by }],
  });
}

export function cadenceOf({ row }: ConversationPlace): Cadence {
  return { open: row.open, active_at: row.active_at, reads: row.reads, next_read_at: row.next_read_at };
}

export function resting({ row }: ConversationPlace): Cadence {
  return { open: false, active_at: row.active_at, reads: row.reads, next_read_at: null };
}
