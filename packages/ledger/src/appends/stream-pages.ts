import { Schema } from 'effect';

export const mostMessagesInAStreamPage = 1000;

const SizedPositions = Schema.Array(Schema.Struct({ position: Schema.Number, size: Schema.Number }));

export type SizedPosition = (typeof SizedPositions.Type)[number];

export type SizesAfter = (stream: string, after: number, count: number) => Promise<readonly SizedPosition[]>;

export function sizedPositionsOf(rows: readonly unknown[]): readonly SizedPosition[] {
  return Schema.decodeUnknownSync(SizedPositions)(rows);
}

export interface PageCut {
  readonly through: number;
  readonly more: boolean;
}

export function pageCutOf(sized: readonly SizedPosition[], after: number, mostBytes: number): PageCut {
  let loaded = 0;
  let through = after;
  let taken = 0;
  for (const { position, size } of sized.slice(0, mostMessagesInAStreamPage)) {
    if (taken > 0 && loaded + size > mostBytes) {
      break;
    }
    loaded += size;
    through = position;
    taken += 1;
  }
  return { through, more: taken < sized.length };
}
