import { Conflict } from '@on.auto/operations';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import type { DefinitionCommand } from './definition-commands.ts';
import type { DefinitionRegistry } from './definition-registry.ts';
import type { StoredDefinition } from './definition.ts';

export type SubjectOf = (details: StoredDefinition['details']) => string | undefined;

function subjectInWords(subject: string): string {
  const slash = subject.indexOf('/');
  return slash === -1
    ? `The ${subject}`
    : `The ${definitionResourceLabel(subject.slice(0, slash))} ${subject.slice(slash + 1)}`;
}

export function presentedAlready(
  subjectOf: SubjectOf,
  command: DefinitionCommand,
  registry: DefinitionRegistry,
): Conflict | undefined {
  const subject = command.type === 'create' ? subjectOf(command.content.details) : undefined;
  const presenting = [...registry.values()].find(
    ({ status, details }) => status === 'active' && subject !== undefined && subjectOf(details) === subject,
  );
  return presenting === undefined || subject === undefined
    ? undefined
    : new Conflict({
        detail: `${subjectInWords(subject)} already has the page ${presenting.name}, and a subject has one page at a time; update that page, or retire it before saving another`,
      });
}
