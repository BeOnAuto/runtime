import { waitBefore } from './cadence.ts';
import type { Cadence, ConversationRow } from './conversation-rows.ts';

export interface ReadEnd {
  readonly now: number;
  readonly floorMs: number;
  readonly open: boolean;
  readonly foundAnswerer: boolean;
  readonly retryAfterMs: number | null;
  readonly waitedAfter: string | null;
  readonly nextReading: number;
}

export function cadenceAfter(row: ConversationRow, end: ReadEnd): Cadence {
  const reads = end.foundAnswerer ? 0 : row.reads + 1;
  const activeAt = end.foundAnswerer ? end.now : row.active_at;
  const wait = waitBefore({ read: reads + 1, floorMs: end.floorMs, retryAfterMs: end.retryAfterMs });
  return {
    open: end.open,
    active_at: activeAt,
    reads,
    next_read_at: end.open ? end.now + wait : null,
    next_reading: end.nextReading,
    waited_after: end.waitedAfter,
  };
}
