import { Buffer } from 'node:buffer';

import { PlaybookIdSchema } from '@on.auto/operations';
import { Option, Schema } from 'effect';

export interface ActivityPosition {
  readonly at: number;
  readonly playbook: string;
  readonly key: string;
}

const mostKeyCharacters = 200;

const PositionSchema = Schema.Struct({
  at: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  playbook: PlaybookIdSchema,
  key: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(mostKeyCharacters)),
});

const positionIn = Schema.decodeUnknownOption(Schema.fromJsonString(PositionSchema));

function textOrder(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

export function positionOrder(left: ActivityPosition, right: ActivityPosition): number {
  if (left.at !== right.at) {
    return left.at < right.at ? -1 : 1;
  }
  return left.playbook === right.playbook ? textOrder(left.key, right.key) : textOrder(left.playbook, right.playbook);
}

export function isAfter(position: ActivityPosition, other: ActivityPosition): boolean {
  return positionOrder(position, other) > 0;
}

export function newestFirst(left: ActivityPosition, right: ActivityPosition): number {
  return positionOrder(right, left);
}

export function cursorOf({ at, playbook, key }: ActivityPosition): string {
  return Buffer.from(JSON.stringify({ at, playbook, key }), 'utf8').toString('base64url');
}

export function positionOfCursor(cursor: string): ActivityPosition | undefined {
  return Option.getOrUndefined(positionIn(Buffer.from(cursor, 'base64url').toString('utf8')));
}
