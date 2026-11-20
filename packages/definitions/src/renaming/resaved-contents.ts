import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { documentCheckedOf, type WrittenDefinition } from '../operations/definition-views.ts';
import { withTheTextsKept } from '../operations/saved-content.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';
import type { RenameMember } from './rename-members.ts';

export interface WrittenAgain {
  readonly member: RenameMember;
  readonly texts: WrittenDefinition;
}

interface KeptContent {
  readonly content: DefinitionContent;
  readonly inHand: ReadonlyMap<string, string>;
}

export interface Resaving {
  readonly pages: SubjectPages;
}

export const resavedContent = Effect.fnUntraced(function* (
  capability: Capability,
  written: WrittenDefinition,
  { pages }: Resaving,
) {
  const checked = yield* documentCheckedOf(capability, written, pages);
  const kept: KeptContent = yield* withTheTextsKept(checked, written);
  return kept;
});
