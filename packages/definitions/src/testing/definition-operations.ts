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
import type { SubjectPages } from '../page/subject-pages-port.ts';
import { storedTypesByStatus } from '../reading/run-status.ts';
import { uncheckedPages } from './page-ports.ts';

export function definitionOperationsFor(
  capabilities: readonly Capability[],
  presenters: readonly Presenter[] = makeDefinitionPresenters(capabilities),
  pages: SubjectPages = uncheckedPages,
) {
  return {
    createDefinition: defineCreateDefinition(capabilities, pages),
    listDefinitions: defineListDefinitions(capabilities),
    getDefinition: defineGetDefinition(capabilities, pages),
    updateDefinition: defineUpdateDefinition(capabilities, pages),
    pauseDefinition: definePauseDefinition(capabilities),
    resumeDefinition: defineResumeDefinition(capabilities),
    retireDefinition: defineRetireDefinition(capabilities),
    restoreDefinition: defineRestoreDefinition(capabilities),
    runDefinition: defineRunDefinition(capabilities),
    getRun: defineGetRun(capabilities, pages),
    cancelRun: defineCancelRun(capabilities),
    listRuns: defineListRuns(capabilities, storedTypesByStatus(declaredFactsOf(capabilities))),
    getRunHistory: defineGetRunHistory(presenters),
  };
}
