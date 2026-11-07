import { InvalidInput } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { ofTheOrg } from '../positions/activity-addresses.ts';
import { positionOfCursor, type ActivityPosition } from '../positions/activity-position.ts';
import { activityKinds, type ActivityKind } from './activity-row.ts';
import type { PlaybookRegister } from './playbook-register.ts';

export const mostRowsInAPage = 200;

export const rowsInAPage = 50;

const longestCursor = 512;

export function cursorField(description: string) {
  return Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(longestCursor)).annotate({ description });
}

export function refusedAt(pointer: string, detail: string): InvalidInput {
  return new InvalidInput({ detail, issues: [{ pointer, detail }] });
}

export function positionAt(
  field: string,
  cursor: string | undefined,
  { known }: PlaybookRegister,
): Effect.Effect<ActivityPosition | undefined, InvalidInput> {
  if (cursor === undefined) {
    return Effect.undefined;
  }
  const position = positionOfCursor(cursor);
  return position !== undefined && (position.playbook === ofTheOrg || known.has(position.playbook))
    ? Effect.succeed(position)
    : Effect.fail(refusedAt(`/${field}`, `Expected a cursor of a row of the activity of this org in ${field}`));
}

function isKind(kind: string): kind is ActivityKind {
  return activityKinds.some((each) => each === kind);
}

export function kindsOf(kind: string | undefined): Effect.Effect<ReadonlySet<ActivityKind>, InvalidInput> {
  const asked = kind === undefined ? activityKinds : kind.split(',').map((each) => each.trim());
  const kinds = asked.filter((each) => isKind(each));
  return kinds.length === asked.length && kinds.length > 0
    ? Effect.succeed(new Set(kinds))
    : Effect.fail(
        refusedAt('/kind', 'Expected needs_you, broken, new or comment, or several of them separated by commas'),
      );
}
