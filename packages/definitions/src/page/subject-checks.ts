import type { InvalidInput, PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import type { DefinitionKind, Presenting } from '../capability/definition-kinds.ts';
import { definitionResourceLabel } from '../capability/function-terminology.ts';
import { issueText } from '../document/document-issue.ts';
import { rejectionOfSource } from '../operations/issue-pointers.ts';
import { loadRegistry } from '../operations/registry-access.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';

interface SubjectSaving {
  readonly capability: DefinitionKind;
  readonly content: DefinitionContent;
  readonly types: readonly string[];
}

function refusedSubject(presents: Presenting, source: string, detail: string): InvalidInput {
  const line = presents.subjectLineOf(source);
  return rejectionOfSource({
    detail: 'The page has a problem',
    issues: [{ pointer: '', detail: issueText({ line, pointer: '/of', detail }) }],
  });
}

export function absenceOf(
  types: readonly string[],
  type: string,
  name: string,
): Effect.Effect<string | undefined, never, PlaybookReader> {
  const named = `the ${definitionResourceLabel(type)} ${name}`;
  const lacking = `of names ${named}, which the playbook does not have; a page presents what the playbook has`;
  if (!types.includes(type)) {
    return Effect.succeed(lacking);
  }
  return Effect.map(loadRegistry(type), (registry) => {
    const found = registry.get(name);
    if (found === undefined) {
      return lacking;
    }
    return found.status === 'retired'
      ? `of names ${named}, which the playbook retired; a page presents what the playbook has`
      : undefined;
  });
}

export function subjectChecked({
  capability: { presents },
  content,
  types,
}: SubjectSaving): Effect.Effect<void, InvalidInput, PlaybookReader> {
  const subject = presents?.definitionPresentedBy(content.details);
  if (presents === undefined || subject === undefined) {
    return Effect.void;
  }
  const { type, name } = subject;
  return Effect.flatMap(absenceOf(types, type, name), (absence) =>
    absence === undefined ? Effect.void : Effect.fail(refusedSubject(presents, content.source, absence)),
  );
}

export function subjectKept(
  { type, presents }: DefinitionKind,
  name: string,
  content: DefinitionContent,
): Effect.Effect<void, InvalidInput, PlaybookReader> {
  if (presents === undefined) {
    return Effect.void;
  }
  return Effect.flatMap(loadRegistry(type), (registry) => {
    const saved = presents.subjectOf(registry.get(name)?.details);
    const given = presents.subjectOf(content.details);
    return saved === undefined || saved === given
      ? Effect.void
      : Effect.fail(
          refusedSubject(
            presents,
            content.source,
            `A page belongs to its subject, so of stays ${saved}; to present another subject, retire this page and save a new one`,
          ),
        );
  });
}
