import type { Ledger, PlaybookAddress, PlaybookRegistry, RouteRegistration } from '@on.auto/operations';
import type { FilterSandbox } from '@on.auto/workflow-engine';
import type { DueWork, FollowerConsumers, HostDatabase } from '@on.auto/workflow-host';

import { assessorOf } from '../assessor/assessor.ts';
import { stoppedCatchUpOf } from '../catching-up/stopped-catch-up.ts';
import type { CallerRule } from '../chain-origins/chain-origin.ts';
import { ledgerChainReads } from '../chain-origins/ledger-chain-reads.ts';
import { goalsClockOf } from '../clock/goals-clock.ts';

export interface GoalsPorts {
  readonly database: HostDatabase;
  readonly ledger: Ledger['Service'];
  readonly registry: PlaybookRegistry['Service'];
  readonly callers: CallerRule;
  readonly filters: FilterSandbox;
  readonly now: () => number;
}

export interface GoalsOperation {
  readonly registration: RouteRegistration<'playbook'>;
}

export interface GoalsHostParts {
  readonly consumers: FollowerConsumers;
  readonly dueWork: readonly DueWork[];
  readonly playbookOperations: readonly GoalsOperation[];
}

export const goalsKeptNowhere: GoalsHostParts = { consumers: [], dueWork: [], playbookOperations: [] };

export function goalsHostParts(ports: GoalsPorts): GoalsHostParts {
  const assessorPorts = {
    ledger: ports.ledger,
    chainsOf: (playbook: PlaybookAddress) => ledgerChainReads(ports.database.store, playbook),
    callers: ports.callers,
    filters: ports.filters,
    now: ports.now,
  };
  return {
    consumers: [assessorOf(assessorPorts)],
    dueWork: [goalsClockOf({ ledger: ports.ledger, registry: ports.registry }), stoppedCatchUpOf(assessorPorts)],
    playbookOperations: [],
  };
}

export function goalsHostPartsWhere(kept: boolean, ports: () => GoalsPorts): GoalsHostParts {
  return kept ? goalsHostParts(ports()) : goalsKeptNowhere;
}
