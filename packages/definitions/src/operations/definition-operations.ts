import type { Registration, RouteRegistration } from '@on.auto/operations';

import type { Capability } from '../capability/capability.ts';
import { defineExportPlaybook } from '../exporting/export-playbook.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import { runOperations, type RunReading } from '../reading/run-operations.ts';
import { operationsOnDefinitions } from './definition-catalog.ts';
import { noGoalsKept, type GoalsKeeping } from './saved-content.ts';

export interface PlaybookOperation {
  readonly registration: Registration<'playbook'>;
}

interface ServedOperation {
  readonly registration: RouteRegistration<'playbook'>;
}

export function makeDefinitionOperations(
  capabilities: readonly Capability[],
  pages: SubjectPages,
  reading: RunReading,
  kept: GoalsKeeping = noGoalsKept,
): readonly ServedOperation[] {
  return [
    ...operationsOnDefinitions(capabilities, pages, kept),
    ...runOperations(capabilities, reading),
    ...(kept.goals ? [defineExportPlaybook(capabilities, pages)] : []),
  ];
}
