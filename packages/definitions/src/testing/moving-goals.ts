import { Caller, PlaybookContext, playbookLedgerOf } from '@on.auto/operations';
import { Effect } from 'effect';

import { savedPage, savePlaybook } from '../exporting/playbook-saving.ts';
import { playbookGoalsAgreed, type GoalSeen } from '../goals/goal-agreements.ts';
import { playbookGoalsIn, type PlaybookGoals } from '../goals/playbook-goals.ts';
import { defineMoveDefinitions } from '../moving/move-definitions.ts';
import { acmeAdmin } from './callers.ts';
import { notifying } from './capabilities/notifying.ts';
import { definitionOperationsFor } from './definition-operations.ts';
import { connections, movingCapabilities, startedOf, toAlpha, toBeta, type Definitions } from './moving.ts';

export const goalCapabilities = [...movingCapabilities, notifying];

export const goalOperations = definitionOperationsFor(goalCapabilities);

export function moveWithGoalsWhere(messages: boolean) {
  return defineMoveDefinitions(goalCapabilities, {
    kept: { goals: true, messages },
    started: startedOf(goalCapabilities),
    connections,
  });
}

export const moveWithGoals = moveWithGoalsWhere(true);

export const tellOwner = { type: 'interaction', name: 'tell-owner' };

const success = { label: 'Leads', settles: 'on_crossing', target: { at_least: 1 }, passed: 'Met', failed: 'Missed' };

export function aGoal(id: string, more: object = {}) {
  return { id, statement: `The goal kept as ${id}.`, success, ...more };
}

export const toldThroughTheOwner = { notify: { passed: 'quiet', failed: 'now', through: tellOwner.name } };

export function serving(goals: readonly string[], more: object = {}): string {
  return JSON.stringify({ contributes: goals.map((goal) => ({ goal, purpose: 'Does the work.' })), ...more });
}

function toThe(playbook: string) {
  return playbook === 'alpha' ? toAlpha : toBeta;
}

export function goalsSavedIn(definitions: Definitions, playbook: string, goals: readonly object[]) {
  return definitions.call(savePlaybook, toThe(playbook)(acmeAdmin, { page: savedPage, goals: JSON.stringify(goals) }));
}

export function goalsIn(definitions: Definitions, playbook: string): Promise<PlaybookGoals> {
  const address = { org: 'acme', playbook };
  return definitions.run(Effect.provide(playbookGoalsIn, playbookLedgerOf(definitions.ledger.service, address)));
}

export function agreedIn(definitions: Definitions, playbook: string, goals: readonly GoalSeen[]) {
  const address = { org: 'acme', playbook };
  return definitions.run(
    Effect.result(
      playbookGoalsAgreed({ goals }).pipe(
        Effect.provide(playbookLedgerOf(definitions.ledger.service, address)),
        Effect.provideService(PlaybookContext, address),
        Effect.provideService(Caller, acmeAdmin),
      ),
    ),
  );
}

export function movingWithGoals(definitions: Definitions, input: object, from = 'alpha', operation = moveWithGoals) {
  return definitions.call(operation, toThe(from)(acmeAdmin, { to: from === 'alpha' ? 'beta' : 'alpha', ...input }));
}
