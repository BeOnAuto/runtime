import type { RouteRegistration } from '@on.auto/operations';

import { memoryPortsOf, type MemoryFunctionAdapterOptions } from '../capability/memory-ports.ts';
import { defineForget } from './forget-operation.ts';
import { defineListMemories, defineListOrgMemories } from './memory-listing.ts';
import { defineMoveMemory } from './move-operation.ts';
import { defineRecall } from './recall-operation.ts';
import { defineRemember } from './remember-operation.ts';

interface PlaybookRoute {
  readonly registration: RouteRegistration<'playbook'>;
}

interface OrgRoute {
  readonly registration: RouteRegistration<'org'>;
}

export interface MemoryOperations {
  readonly remember: PlaybookRoute;
  readonly recall: PlaybookRoute;
  readonly forget: PlaybookRoute;
  readonly moveMemory: PlaybookRoute;
  readonly listMemories: PlaybookRoute;
  readonly listOrgMemories: OrgRoute;
  readonly inPlaybook: readonly PlaybookRoute[];
  readonly inOrg: readonly OrgRoute[];
}

export function memoryOperationsOf(options: MemoryFunctionAdapterOptions): MemoryOperations {
  const ports = memoryPortsOf(options);
  const remember = defineRemember(ports);
  const recall = defineRecall(ports);
  const forget = defineForget(ports);
  const moveMemory = defineMoveMemory(ports);
  const listMemories = defineListMemories(ports);
  const listOrgMemories = defineListOrgMemories(ports);
  return {
    remember,
    recall,
    forget,
    moveMemory,
    listMemories,
    listOrgMemories,
    inPlaybook: [remember, recall, forget, moveMemory, listMemories],
    inOrg: [listOrgMemories],
  };
}
