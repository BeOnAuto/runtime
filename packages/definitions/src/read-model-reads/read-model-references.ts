import type { PlaybookContext, PlaybookReader, ProjectedKeyedRow } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { ReadModelRefused } from './read-model-refused.ts';
import {
  everyRowOf,
  inThePlaybookOf,
  pointerDisagrees,
  rowOfTheDefinition,
  type Read,
  type ReadModelReader,
} from './read-model-rows.ts';

const ReferenceRowSchema = Schema.Struct({
  user_type: Schema.String,
  used_type: Schema.String,
  used_name: Schema.String,
  relation: Schema.Literals(['calls', 'reads']),
  places: Schema.String,
});

export type ReferenceRow = typeof ReferenceRowSchema.Type & { readonly user_name: string };

const decodeReferenceRow = Schema.decodeUnknownSync(ReferenceRowSchema);

type UnnamedReference = typeof ReferenceRowSchema.Type;

interface ReferencesOfAUser {
  readonly user: string;
  readonly type: string;
  readonly references: readonly UnnamedReference[];
}

function referencesByUser(rows: readonly ProjectedKeyedRow[]): readonly ReferencesOfAUser[] {
  const byUser = new Map<string, ReferencesOfAUser>();
  for (const { row, definition: user } of rows) {
    if (user !== undefined) {
      const reference = decodeReferenceRow(row);
      const references = [...(byUser.get(user)?.references ?? []), reference];
      byUser.set(user, { user, type: reference.user_type, references });
    }
  }
  return [...byUser.values()];
}

function namedByTheirUser(
  reader: ReadModelReader,
  { user, type, references }: ReferencesOfAUser,
): Read<readonly ReferenceRow[]> {
  return Effect.flatMap(rowOfTheDefinition(reader, type, user), (row) =>
    row === undefined
      ? Effect.fail(pointerDisagrees)
      : Effect.succeed(references.map((reference) => ({ ...reference, user_name: row.name }))),
  );
}

export function referencesTo(
  type: string,
  name: string,
): Effect.Effect<readonly ReferenceRow[], ReadModelRefused, PlaybookReader | PlaybookContext> {
  return inThePlaybookOf((reader) =>
    Effect.flatMap(
      everyRowOf(reader, 'definition_references', [
        { column: 'used_type', equals: type },
        { column: 'used_name', equals: name },
      ]),
      (rows) =>
        Effect.map(
          Effect.forEach(referencesByUser(rows), (ofAUser) => namedByTheirUser(reader, ofAUser)),
          (named: readonly (readonly ReferenceRow[])[]) => named.flat(),
        ),
    ),
  );
}
