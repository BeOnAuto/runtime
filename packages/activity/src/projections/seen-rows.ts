import { recordedDecoder, type KeyedProjection, type ProjectedRow } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { ActivitySeenSchema, activityStreamKind, type SeenItem, type SeenThrough } from '../facts/activity-seen.ts';
import { itemOfAddress, positionOfItem } from '../positions/activity-addresses.ts';
import { isAfter, newestFirst, type ActivityPosition } from '../positions/activity-position.ts';

export const seenName = 'activity_seen';

export const mostMarksKept = 1000;

const MarkSchema = Schema.Struct({ address: Schema.String, at: Schema.Int });

export type Mark = typeof MarkSchema.Type;

const marksIn = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(MarkSchema)));

const seenFactOf = recordedDecoder(ActivitySeenSchema);

interface Placed {
  readonly mark: Mark;
  readonly position: ActivityPosition;
}

export interface Seen {
  readonly through: ActivityPosition | undefined;
  readonly marks: readonly Mark[];
  readonly seenAt: number | null;
}

function textIn(row: ProjectedRow | undefined, column: string): string | undefined {
  const value = row?.[column];
  return typeof value === 'string' ? value : undefined;
}

function numberIn(row: ProjectedRow | undefined, column: string): number | null {
  const value = row?.[column];
  return typeof value === 'number' ? value : null;
}

function throughIn(row: ProjectedRow | undefined): ActivityPosition | undefined {
  const at = numberIn(row, 'through_at');
  const playbook = textIn(row, 'through_playbook');
  const key = textIn(row, 'through_key');
  return at === null || playbook === undefined || key === undefined ? undefined : { at, playbook, key };
}

export function seenOf(row?: ProjectedRow): Seen {
  return {
    through: throughIn(row),
    marks: Option.getOrElse(marksIn(textIn(row, 'marked') ?? '[]'), () => []),
    seenAt: numberIn(row, 'seen_at'),
  };
}

function placed(mark: Mark): readonly Placed[] {
  const item = itemOfAddress(mark.address);
  return item === undefined || !Number.isSafeInteger(mark.at)
    ? []
    : [{ mark, position: positionOfItem(item, mark.at) }];
}

function markOf({ address, at }: SeenItem): Mark {
  return { address, at: Date.parse(at) };
}

function keptMarks(marks: readonly Mark[], through: ActivityPosition | undefined): readonly Mark[] {
  const latest = new Map(marks.map((mark) => [mark.address, mark]));
  return [...latest.values()]
    .flatMap((mark) => placed(mark))
    .filter(({ position }) => through === undefined || isAfter(position, through))
    .toSorted((left, right) => newestFirst(left.position, right.position))
    .slice(0, mostMarksKept)
    .map(({ mark }) => mark);
}

function positionOfThrough({ at, playbook, key }: SeenThrough): ActivityPosition | undefined {
  const time = Date.parse(at);
  return Number.isSafeInteger(time) ? { at: time, playbook, key } : undefined;
}

function movedThrough(kept: ActivityPosition | undefined, asked: SeenThrough | undefined) {
  const position = asked === undefined ? undefined : positionOfThrough(asked);
  return position !== undefined && (kept === undefined || isAfter(position, kept)) ? position : undefined;
}

function throughColumnsOf(through: ActivityPosition | undefined) {
  return {
    through_at: through?.at ?? null,
    through_playbook: through?.playbook ?? null,
    through_key: through?.key ?? null,
  };
}

export const seenRows: KeyedProjection = {
  name: seenName,
  version: 1,
  scopes: ['org'],
  kinds: [activityStreamKind],
  types: ['activity_seen'],
  columns: [
    { name: 'through_at', kind: 'integer' },
    { name: 'through_playbook', kind: 'text' },
    { name: 'through_key', kind: 'text' },
    { name: 'marked', kind: 'text' },
    { name: 'seen_at', kind: 'integer' },
  ],
  indexes: [],
  keyOf: ({ context }) => context.by,
  rowAfter: (row, message) =>
    Option.getOrUndefined(
      Option.map(seenFactOf(message), ({ data, context }): ProjectedRow => {
        const kept = seenOf(row);
        const moved = movedThrough(kept.through, data.through);
        const through = moved ?? kept.through;
        return {
          ...throughColumnsOf(through),
          marked: JSON.stringify(keptMarks([...kept.marks, ...data.items.map((item) => markOf(item))], through)),
          seen_at: moved === undefined ? kept.seenAt : Date.parse(context.at),
        };
      }),
    ),
};
