import type { Replies } from '../tool-blocks/tool-block-schemas.ts';
import { waitBefore } from './cadence.ts';
import type { Cadence, ConversationRow } from './conversation-rows.ts';

export function cursorOf(order: Replies['read']['order'], ids: readonly string[], prior: string | null): string | null {
  return (order === 'oldest_first' ? ids.at(-1) : ids.at(0)) ?? prior;
}

export interface ReadEnd {
  readonly now: number;
  readonly floorMs: number;
  readonly open: boolean;
  readonly foundAnswerer: boolean;
  readonly retryAfterMs: number | null;
}

export function cadenceAfter(row: ConversationRow, end: ReadEnd): Cadence {
  const reads = end.foundAnswerer ? 0 : row.reads + 1;
  const activeAt = end.foundAnswerer ? end.now : row.active_at;
  const wait = waitBefore({ read: reads + 1, floorMs: end.floorMs, retryAfterMs: end.retryAfterMs });
  return { open: end.open, active_at: activeAt, reads, next_read_at: end.open ? end.now + wait : null };
}
