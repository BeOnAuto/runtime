import { OrgReader } from '@on.auto/operations';
import { Clock, Effect } from 'effect';

import { cursorOf, isAfter, type ActivityPosition } from '../positions/activity-position.ts';
import { seenName, seenOf, type Seen } from '../projections/seen-rows.ts';
import { addressOfRow, isoOf, type ActivityRow } from './activity-row.ts';

const unmarkedLookback = 7 * 24 * 60 * 60 * 1000;

export interface Viewer {
  readonly caller: string;
  readonly address: string | undefined;
  readonly seen: Seen;
  readonly through: ActivityPosition;
  readonly marked: ReadonlyMap<string, number>;
}

export interface ServedThrough {
  readonly cursor: string;
  readonly seen_at: string;
}

export const viewerOf = Effect.fnUntraced(function* (caller: string, address: string | undefined) {
  const reader = yield* OrgReader;
  const [kept] = yield* reader.readProjectedRows(seenName, {
    where: [{ column: 'row_key', equals: caller }],
    orderBy: [],
    order: 'asc',
    limit: 1,
  });
  const seen = seenOf(kept?.row);
  const now = yield* Clock.currentTimeMillis;
  const viewer: Viewer = {
    caller,
    address,
    seen,
    through: seen.through ?? { at: now - unmarkedLookback, playbook: '', key: '' },
    marked: new Map(seen.marks.map(({ address: marked, at }) => [marked, at])),
  };
  return viewer;
});

export function isSeenBy(viewer: Viewer, row: ActivityRow): boolean {
  const markedAt = viewer.marked.get(addressOfRow(row));
  return (
    (row.reopenedBy ?? row.by) === viewer.caller ||
    (markedAt !== undefined && markedAt >= row.position.at) ||
    !isAfter(row.position, viewer.through)
  );
}

export function throughOf({ through, seenAt }: Seen): ServedThrough | null {
  return through === undefined || seenAt === null ? null : { cursor: cursorOf(through), seen_at: isoOf(seenAt) };
}
