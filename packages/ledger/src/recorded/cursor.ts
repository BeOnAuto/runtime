import { cursorOfParts, partsOfCursor, type CursorPart, type InvalidCursorKind } from '@on.auto/operations';
import { Option, Result } from 'effect';

import type { RecordedPoint } from '../event-store.ts';

export interface CursorPoint {
  readonly point: RecordedPoint;
  readonly within: boolean;
}

const largestPosition = 2n ** 63n - 1n;

const decimal = /^(?:0|[1-9]\d{0,18})$/u;

export function isPosition(part: CursorPart): part is string {
  return typeof part === 'string' && decimal.test(part) && BigInt(part) <= largestPosition;
}

function isIndex(part: CursorPart | undefined): boolean {
  return part === undefined || (typeof part === 'number' && part >= 0);
}

export function cursorOf(playbookKey: string, point: RecordedPoint): string {
  return cursorOfParts([playbookKey, ...point]);
}

function pointOfParts(
  [key, ...rest]: readonly CursorPart[],
  playbookKey: string,
  pointLength: number,
): Result.Result<CursorPoint, InvalidCursorKind> {
  const parts = rest.slice(0, pointLength);
  const [index, ...beyond] = rest.slice(pointLength);
  const point = parts.filter((part) => isPosition(part));
  const wellFormed = typeof key === 'string' && point.length === pointLength && isIndex(index) && beyond.length === 0;
  if (!wellFormed) {
    return Result.fail('malformed');
  }
  return key === playbookKey
    ? Result.succeed({ point, within: index !== undefined })
    : Result.fail('of_another_playbook');
}

export function pointOf(
  cursor: string,
  playbookKey: string,
  pointLength: number,
): Result.Result<CursorPoint, InvalidCursorKind> {
  return Option.match(partsOfCursor(cursor), {
    onNone: () => Result.fail('malformed'),
    onSome: (parts) => pointOfParts(parts, playbookKey, pointLength),
  });
}
