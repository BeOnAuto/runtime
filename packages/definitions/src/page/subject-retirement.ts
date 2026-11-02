import { Conflict } from '@on.auto/operations';
import { Effect } from 'effect';

import type { DefinitionKind, Presenting } from '../capability/definition-kinds.ts';
import { definitionResourceLabel } from '../capability/function-terminology.ts';
import { loadRegistry, recordInRegistry } from '../operations/registry-access.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { subjectNamed, type DefinitionSubject } from './page-subjects.ts';
import { absenceOf } from './subject-checks.ts';

interface PresentingKind {
  readonly capability: DefinitionKind;
  readonly presents: Presenting;
}

function presentingKindsOf(capabilities: readonly DefinitionKind[]): readonly PresentingKind[] {
  return capabilities.flatMap((capability) =>
    capability.presents === undefined ? [] : [{ capability, presents: capability.presents }],
  );
}

function retiredPagesOf({ capability, presents }: PresentingKind, subject: string) {
  return Effect.flatMap(loadRegistry(capability.type), (registry) =>
    Effect.forEach(
      [...registry.values()].filter(
        ({ status, details }) => status === 'active' && presents.subjectOf(details) === subject,
      ),
      ({ name }) => recordInRegistry(capability, { type: 'retire', name }),
      { discard: true },
    ),
  );
}

export function pagesRetiredWith(capabilities: readonly DefinitionKind[], { type, name }: DefinitionSubject) {
  const subject = subjectNamed(type, name);
  return Effect.forEach(presentingKindsOf(capabilities), (kind) => retiredPagesOf(kind, subject), { discard: true });
}

export const pageHeldByItsSubject = Effect.fnUntraced(function* (
  capability: DefinitionKind,
  types: readonly string[],
  page: StoredDefinition,
) {
  const subject = capability.presents?.definitionPresentedBy(page.details);
  const absence = subject === undefined ? undefined : yield* absenceOf(types, subject.type, subject.name);
  if (subject !== undefined && absence !== undefined) {
    yield* recordInRegistry(capability, { type: 'retire', name: page.name });
    yield* new Conflict({
      detail: `The ${definitionResourceLabel(subject.type)} ${subject.name} was retired while the page ${page.name} was saved, so the page is retired with it; a page presents what the playbook has`,
      kind: 'retired',
    });
  }
});
