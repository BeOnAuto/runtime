import type { InvalidInput, PlaybookContext, PlaybookReader, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import type { DefinitionKind } from '../capability/definition-kinds.ts';
import { subjectChecked, subjectKept } from '../page/subject-checks.ts';
import { pageHeldByItsSubject } from '../page/subject-retirement.ts';
import type { DefinitionCreation } from '../registry/definition-commands.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';
import { checkedContentOf, type WrittenDefinition } from './definition-views.ts';
import { recordInRegistry } from './registry-access.ts';

interface Saving {
  readonly types: readonly string[];
  readonly updating?: string;
}

function subjectsChecked(
  capability: DefinitionKind,
  content: DefinitionContent,
  { types, updating }: Saving,
): Effect.Effect<void, InvalidInput, PlaybookReader> {
  const kept = updating === undefined ? Effect.void : subjectKept(capability, updating, content);
  return Effect.andThen(kept, subjectChecked({ capability, content, types }));
}

export function contentOf(
  capability: DefinitionKind,
  written: WrittenDefinition,
  saving: Saving,
): Effect.Effect<DefinitionContent, InvalidInput | Unavailable, PlaybookContext | PlaybookReader> {
  return checkedContentOf(capability, written).pipe(
    Effect.tap((content) => subjectsChecked(capability, content, saving)),
  );
}

export const createdWithItsSubject = Effect.fnUntraced(function* (
  capability: DefinitionKind,
  creation: DefinitionCreation,
  { types }: Saving,
) {
  const created = yield* recordInRegistry(capability, creation);
  yield* pageHeldByItsSubject(capability, types, created.stored);
  return created;
});
