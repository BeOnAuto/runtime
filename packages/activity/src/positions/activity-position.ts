import { Buffer } from 'node:buffer';

import { PlaybookIdSchema } from '@on.auto/operations';
import { Option, Schema } from 'effect';

export interface ActivityPosition {
  readonly at: number;
  readonly resultAt?: number;
  readonly playbook: string;
  readonly key: string;
}

const mostKeyCharacters = 200;

const PositionSchema = Schema.Struct({
  at: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  playbook: Schema.Union([PlaybookIdSchema, Schema.Literal('')]),
  key: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(mostKeyCharacters)),
  result_at: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});

const positionIn = Schema.decodeUnknownOption(Schema.fromJsonString(PositionSchema));

function order<Value extends string | number>(left: Value, right: Value): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

export function positionOrder(left: ActivityPosition, right: ActivityPosition): number {
  const orders = [
    order(left.at, right.at),
    order(left.resultAt ?? left.at, right.resultAt ?? right.at),
    order(left.playbook, right.playbook),
    order(left.key, right.key),
  ];
  return orders.find((each) => each !== 0) ?? 0;
}

export function isAfter(position: ActivityPosition, other: ActivityPosition): boolean {
  return positionOrder(position, other) > 0;
}

export function newestFirst(left: ActivityPosition, right: ActivityPosition): number {
  return positionOrder(right, left);
}

export function cursorOf({ at, resultAt, playbook, key }: ActivityPosition): string {
  const placed = resultAt === undefined ? { at, playbook, key } : { at, playbook, key, result_at: resultAt };
  return Buffer.from(JSON.stringify(placed), 'utf8').toString('base64url');
}

export function positionOfCursor(cursor: string): ActivityPosition | undefined {
  return Option.getOrUndefined(
    Option.map(positionIn(Buffer.from(cursor, 'base64url').toString('utf8')), ({ at, playbook, key, result_at }) =>
      result_at === undefined ? { at, playbook, key } : { at, resultAt: result_at, playbook, key },
    ),
  );
}
