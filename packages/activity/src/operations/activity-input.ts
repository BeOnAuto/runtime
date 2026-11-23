import { InvalidInput, PlaybookIdSchema } from '@on.auto/operations';
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

export function kindsInWords(kinds: readonly ActivityKind[]): string {
  return `${kinds.slice(0, -1).join(', ')} or ${kinds.slice(-1).join('')}`;
}

export function kindsOf(
  kind: string | undefined,
  known: readonly ActivityKind[] = activityKinds,
): Effect.Effect<ReadonlySet<ActivityKind>, InvalidInput> {
  const isKind = (each: string): each is ActivityKind => known.some((knownKind) => knownKind === each);
  const asked = kind === undefined ? known : kind.split(',').map((each) => each.trim());
  const kinds = asked.filter((each) => isKind(each));
  return kinds.length === asked.length && kinds.length > 0
    ? Effect.succeed(new Set(kinds))
    : Effect.fail(refusedAt('/kind', `Expected ${kindsInWords(known)}, or several of them separated by commas`));
}

export const ListActivityInputSchema = Schema.Struct({
  kind: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'One kind, needs_you, broken, new or comment, or several separated by commas: keep the rows of those kinds',
    }),
  ),
  playbook: Schema.optionalKey(PlaybookIdSchema.annotate({ description: 'Keep the rows of one playbook' })),
  mine: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        'true keeps, of the new and comment rows, those whose by is the caller, and leaves the other kinds as they are',
    }),
  ),
  since: Schema.optionalKey(cursorField('A cursor: keep the rows after the row it names')),
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: mostRowsInAPage })).annotate({
      description: `How many rows a page holds, 1 to ${mostRowsInAPage}; ${rowsInAPage} when left out`,
    }),
  ),
  cursor: Schema.optionalKey(cursorField('The next_cursor of the page before')),
});

export type ListActivityInput = typeof ListActivityInputSchema.Type;

export interface DismissedAsked {
  readonly dismissed?: 'include';
}
