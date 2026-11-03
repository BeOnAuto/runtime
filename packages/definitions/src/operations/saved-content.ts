import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import type { DefinitionCommandData } from '../registry/definition-commands.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';
import { checkedContentOf, type WrittenDefinition } from './definition-views.ts';
import { recordInRegistry } from './registry-access.ts';

interface Saving {
  readonly capability: Capability;
  readonly pages: SubjectPages;
  readonly written: WrittenDefinition;
}

export function savedFrom(
  { capability, pages, written }: Saving,
  commandOf: (content: DefinitionContent) => DefinitionCommandData,
) {
  return Effect.flatMap(checkedContentOf(capability, written, pages), (content) =>
    recordInRegistry(capability, commandOf(content)),
  );
}
