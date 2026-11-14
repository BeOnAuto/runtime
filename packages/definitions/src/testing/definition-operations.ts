import type { Presenter } from '@on.auto/operations';

import {
  declaredFactsOf,
  defineCancelRun,
  defineCreateDefinition,
  defineRunDefinition,
  defineGetRunHistory,
  defineGetDefinition,
  defineListRuns,
  defineListDefinitions,
  definePauseDefinition,
  defineRestoreDefinition,
  defineResumeDefinition,
  defineRetireDefinition,
  defineUpdateDefinition,
  defineGetRun,
  makeDefinitionPresenters,
  type Capability,
} from '../index.ts';
import { noGoalsKept, type GoalsKeeping } from '../operations/saved-content.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import { storedTypesByStatus } from '../reading/run-status.ts';
import { runContentHolders } from './harness.ts';
import { uncheckedPages } from './page-ports.ts';

export function definitionOperationsFor(
  capabilities: readonly Capability[],
  presenters: readonly Presenter[] = makeDefinitionPresenters(capabilities),
  pages: SubjectPages = uncheckedPages,
  kept: GoalsKeeping = noGoalsKept,
) {
  const { goals } = kept;
  return {
    createDefinition: defineCreateDefinition(capabilities, pages, kept),
    listDefinitions: defineListDefinitions(capabilities, goals),
    getDefinition: defineGetDefinition(capabilities, pages, goals),
    updateDefinition: defineUpdateDefinition(capabilities, pages, kept),
    pauseDefinition: definePauseDefinition(capabilities, goals),
    resumeDefinition: defineResumeDefinition(capabilities, goals),
    retireDefinition: defineRetireDefinition(capabilities, goals),
    restoreDefinition: defineRestoreDefinition(capabilities, goals),
    runDefinition: defineRunDefinition(capabilities),
    getRun: defineGetRun(capabilities, pages),
    cancelRun: defineCancelRun(capabilities),
    listRuns: defineListRuns(capabilities, storedTypesByStatus(declaredFactsOf(capabilities))),
    getRunHistory: defineGetRunHistory(presenters, runContentHolders),
  };
}
