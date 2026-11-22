import type { Registration, RouteRegistration } from '@on.auto/operations';

import type { Capability } from '../capability/capability.ts';
import { defineExportPlaybook } from '../exporting/export-playbook.ts';
import { defineMoveDefinitions } from '../moving/move-definitions.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import { runOperations, type RunReading } from '../reading/run-operations.ts';
import { storedTypesByStatus } from '../reading/run-status.ts';
import { composedFactsOf } from '../run-work/declared-facts.ts';
import { operationsOnDefinitions } from './definition-catalog.ts';
import { noGoalsKept, type GoalsKeeping } from './saved-content.ts';

export interface PlaybookOperation {
  readonly registration: Registration<'playbook'>;
}

interface ServedOperation {
  readonly registration: RouteRegistration<'playbook'>;
}

function startedOf(capabilities: readonly Capability[], { facts = composedFactsOf(capabilities) }: RunReading) {
  return storedTypesByStatus(facts.onRuns).started;
}

function movesServed(capabilities: readonly Capability[], reading: RunReading, kept: GoalsKeeping) {
  const { connections } = reading;
  const started = startedOf(capabilities, reading);
  return connections === undefined ? [] : [defineMoveDefinitions(capabilities, { kept, started, connections })];
}

export function makeDefinitionOperations(
  capabilities: readonly Capability[],
  pages: SubjectPages,
  reading: RunReading,
  kept: GoalsKeeping = noGoalsKept,
): readonly ServedOperation[] {
  return [
    ...operationsOnDefinitions(capabilities, pages, kept, startedOf(capabilities, reading)),
    ...runOperations(capabilities, reading),
    ...movesServed(capabilities, reading, kept),
    ...(kept.goals ? [defineExportPlaybook(capabilities, pages)] : []),
  ];
}
