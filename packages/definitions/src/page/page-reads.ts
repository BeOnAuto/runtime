import type { PlaybookAddress, PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import type {
  DefinitionKind,
  PresentedPage,
  Presenting,
  RunShown,
  SubjectShown,
} from '../capability/definition-kinds.ts';
import { loadRegistry } from '../operations/registry-access.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { findDefinition } from '../registry/registry-lookup.ts';
import type { RunDetail } from '../runs/run.ts';

interface SubjectPage {
  readonly presents: Presenting;
  readonly page: StoredDefinition;
}

function pagesOfKind(kind: DefinitionKind, subject: string) {
  const { presents } = kind;
  if (presents === undefined) {
    return Effect.succeed([]);
  }
  return Effect.map(loadRegistry(kind.type), (registry) =>
    [...registry.values()]
      .filter(({ status, details }) => status === 'active' && presents.subjectOf(details) === subject)
      .map((page): SubjectPage => ({ presents, page })),
  );
}

export function subjectPageOf(
  capabilities: readonly DefinitionKind[],
  subject: string,
): Effect.Effect<SubjectPage | undefined, never, PlaybookReader> {
  return Effect.map(
    Effect.forEach(capabilities, (kind) => pagesOfKind(kind, subject)),
    (found: readonly (readonly SubjectPage[])[]) => found.flat()[0],
  );
}

export function presentedPageOf({ name, version, source }: StoredDefinition): PresentedPage {
  return { name, version, source };
}

export function subjectShownOf(type: string, { name, description, version }: StoredDefinition): SubjectShown {
  return { type, name, description: description ?? null, version };
}

export function storedSubjectOf(type: string, name: string): Effect.Effect<StoredDefinition, never, PlaybookReader> {
  return Effect.orDie(Effect.flatMap(loadRegistry(type), (registry) => findDefinition(registry, type, name)));
}

export function playbookShownOf({ playbook }: PlaybookAddress): SubjectShown {
  return { type: 'playbook', name: playbook, description: null, version: null };
}

export function runShownOf({
  status,
  output,
  rejection,
  started_at,
  finished_at,
  definition_version,
}: RunDetail): RunShown {
  if (rejection !== undefined) {
    const { reason, kind, detail } = rejection;
    return { status: 'rejected', rejection: { reason, detail, ...(kind === undefined ? {} : { kind }) } };
  }
  if (status === 'failed' || status === 'rejected') {
    return { status: 'failed' };
  }
  return {
    status,
    output: output ?? null,
    started: started_at,
    ended: finished_at ?? null,
    version: definition_version,
  };
}
