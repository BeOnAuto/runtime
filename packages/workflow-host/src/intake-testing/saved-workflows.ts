import { definitionsReadModel, type StrippedForms, type TriggerFilter as SavedFilter } from '@on.auto/definitions';
import { decidedIn } from '@on.auto/definitions/testing';
import { Ledger, PlaybookRegistry, type Decided, type Decider } from '@on.auto/operations';
import { PlaybookEventSchema, ledgerPlaybookRegistry, playbookRows, playbooksStreamOfOrg } from '@on.auto/playbooks';
import { Effect, Layer, Result } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import {
  alpha,
  at,
  definitionIdNamed,
  definitionKeyNamed,
  eventTrigger,
  byAdmin,
  type TriggerFilter,
} from '../reaction-testing/playbook-writes.ts';
import { zoneClockOf } from '../schedules/zone-clock.ts';
import { onSQLite, openedBesideItsLedger } from '../testing/host-files.ts';
import { triggersActivated, triggersPaused } from '../triggers/trigger-rows.ts';

export interface WorkflowsSaved {
  readonly saved: (name: string, ...filters: readonly TriggerFilter[]) => Promise<void>;
  readonly savedReading: (name: string, filter: TriggerFilter, read: NonNullable<SavedFilter['read']>) => Promise<void>;
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
  const savedReading: WorkflowsSaved['savedReading'] = (name, filter, read) => {
    const reading = { reference: '/schedule/on/any/0', type: filter.type, attributes: filter, read };
    const triggers = [{ kind: 'event', reference: '/schedule/on', filters: [reading] } as const];
    const content = { source: `schedule: ${JSON.stringify({ on: filter, read })}`, triggers };
    return decided({ type: 'create', name, content, created_by: admin, definition_id: definitionIdNamed(name), ...by });
  };
  return {
    saved: (name, ...filters) => savedStripped(name, {}, ...filters),
    savedReading,
    savedStripped,
    edited: (name, ...filters) => decided({ type: 'update', name, content: contentOf(filters), ...by }),
    paused: (name) => decided({ type: 'pause', name, paused_by: admin, ...by }),
    resumed: (name) => decided({ type: 'resume', name, ...by }),
    retired: (name) => decided({ type: 'retire', name, ...by }),
  };
}

function registryOn(ledger: Ledger['Service']): Promise<PlaybookRegistry['Service']> {
  return Effect.runPromise(
    Effect.provide(
      Effect.service(PlaybookRegistry),
      ledgerPlaybookRegistry.pipe(Layer.provide(Layer.succeed(Ledger, ledger))),
    ),
  );
}

type PlaybookFact = Decided<typeof PlaybookEventSchema.Type>;

const playbookFactsAsTheyCome: Decider<null, readonly PlaybookFact[], typeof PlaybookEventSchema.Type> = {
  initialState: null,
  evolve: () => null,
  decide: (facts) => Result.succeed(facts),
  context: () => byAdmin,
  eventSchema: PlaybookEventSchema,
};

function playbookRecorded(ledger: Ledger['Service'], fact: PlaybookFact): Promise<unknown> {
  return Effect.runPromise(ledger.execute(playbooksStreamOfOrg('acme'), playbookFactsAsTheyCome, [fact]));
}

export async function aPlaybookBesideItsLedger() {
  const { database, ledger } = await openedBesideItsLedger({
    ...(await onSQLite()),
    projections: [...definitionsReadModel, playbookRows],
  });
  await playbookRecorded(ledger, {
    type: 'playbook_created',
    data: { playbook: 'alpha', name: 'alpha', description: '', created_by: { id: 'acme-admin', name: 'acme-admin' } },
  });
  const statusRecorded = (type: 'playbook_retired' | 'playbook_restored') => () =>
    playbookRecorded(ledger, { type, data: { playbook: 'alpha' } });
  const playbook = { retired: statusRecorded('playbook_retired'), restored: statusRecorded('playbook_restored') };
  return { database, ledger, registry: await registryOn(ledger), workflows: workflowsSavedIn(ledger), playbook };
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
