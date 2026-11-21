import { definitionsReadModel, type StrippedForms } from '@on.auto/definitions';
import { decidedIn } from '@on.auto/definitions/testing';
import type { Ledger } from '@on.auto/operations';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import {
  alpha,
  at,
  definitionIdNamed,
  definitionKeyNamed,
  eventTrigger,
  type TriggerFilter,
} from '../reaction-testing/playbook-writes.ts';
import { zoneClockOf } from '../schedules/zone-clock.ts';
import { onSQLite, openedBesideItsLedger } from '../testing/host-files.ts';
import { triggersActivated, triggersPaused } from '../triggers/trigger-rows.ts';

export interface WorkflowsSaved {
  readonly saved: (name: string, ...filters: readonly TriggerFilter[]) => Promise<void>;
  readonly savedStripped: (
    name: string,
    stripped: StrippedForms,
    ...filters: readonly TriggerFilter[]
  ) => Promise<void>;
  readonly edited: (name: string, ...filters: readonly TriggerFilter[]) => Promise<void>;
  readonly paused: (name: string) => Promise<void>;
  readonly resumed: (name: string) => Promise<void>;
  readonly retired: (name: string) => Promise<void>;
}

const admin = { id: 'acme-admin', name: 'acme-admin' };

function contentOf(filters: readonly TriggerFilter[], stripped: StrippedForms = {}) {
  return { source: `schedule: ${JSON.stringify({ on: filters })}`, triggers: [eventTrigger(...filters)], stripped };
}

function workflowsSavedIn(ledger: Ledger['Service']): WorkflowsSaved {
  const decided = (command: Parameters<typeof decidedIn>[3]) =>
    Effect.runPromise(decidedIn(ledger, { org: 'acme', playbook: 'alpha' }, 'workflow', command));
  const by = { by: admin.id, at };
  const savedStripped: WorkflowsSaved['savedStripped'] = (name, stripped, ...filters) =>
    decided({
      type: 'create',
      name,
      content: contentOf(filters, stripped),
      created_by: admin,
      definition_id: definitionIdNamed(name),
      ...by,
    });
  return {
    saved: (name, ...filters) => savedStripped(name, {}, ...filters),
    savedStripped,
    edited: (name, ...filters) => decided({ type: 'update', name, content: contentOf(filters), ...by }),
    paused: (name) => decided({ type: 'pause', name, paused_by: admin, ...by }),
    resumed: (name) => decided({ type: 'resume', name, ...by }),
    retired: (name) => decided({ type: 'retire', name, ...by }),
  };
}

export async function aPlaybookBesideItsLedger() {
  const { database, ledger } = await openedBesideItsLedger({
    ...(await onSQLite()),
    projections: definitionsReadModel,
  });
  return { database, ledger, workflows: workflowsSavedIn(ledger) };
}

export function followedTo(database: HostDatabase, name: string, ...filters: readonly TriggerFilter[]): Promise<void> {
  const place = { playbookKey: alpha, definitionKey: definitionKeyNamed(name) };
  const activation = {
    version: 1,
    activatedBy: 'definition-1',
    activatedAt: Date.parse(at),
    triggers: [eventTrigger(...filters)],
  };
  return Effect.runPromise(triggersActivated(database, place, activation, zoneClockOf));
}

export function pausedByTheFollower(database: HostDatabase, name: string): Promise<void> {
  return Effect.runPromise(triggersPaused(database, { playbookKey: alpha, definitionKey: definitionKeyNamed(name) }));
}
