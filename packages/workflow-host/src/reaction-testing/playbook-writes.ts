import type { Trigger } from '@on.auto/definitions';
import { eventAppenderOf, type LedgerStreams } from '@on.auto/ledger';
import {
  ContextSchema,
  messageIdOf,
  noLineage,
  uuidV5,
  type Context,
  type Decided,
  type Lineage,
} from '@on.auto/operations';
import { playbooksStreamOfOrg } from '@on.auto/playbooks';
import type { Json } from '@on.auto/workflow-engine';
import { Effect, Schema } from 'effect';

import { definitionKeyOfTheTests } from '../testing/host-documents.ts';

export const alpha = 'playbook/acme/alpha/';

export const at = '2026-10-01T09:00:00.000Z';

const definitionsOfTheTests = '9b2f6c1e-4d3a-5e7b-8c90-1a2b3c4d5e6f';

const namesOfKeys = new Map<string, string>();

export function definitionIdNamed(name: string, type = 'workflow', playbookKey = alpha): string {
  return uuidV5(definitionsOfTheTests, JSON.stringify([playbookKey, type, name]));
}

export function definitionKeyOfType(type: string, name: string, playbookKey = alpha): string {
  const [, org = ''] = playbookKey.split('/');
  const definitionKey = `definition/${org}/${definitionIdNamed(name, type, playbookKey)}/`;
  namesOfKeys.set(definitionKey, name);
  return definitionKey;
}

export function definitionKeyNamed(name: string, playbookKey = alpha): string {
  return definitionKeyOfType('workflow', name, playbookKey);
}

export function nameOfKey(definitionKey: string): string | undefined {
  return namesOfKeys.get(definitionKey);
}

export function definitionStreamNamed(name: string, playbookKey = alpha): string {
  return `${definitionKeyNamed(name, playbookKey)}definitions/workflow`;
}

const AnyRecordSchema = Schema.Struct({ type: Schema.String, data: Schema.JsonObject, context: ContextSchema });

type AnyRecord = Decided<typeof AnyRecordSchema.Type>;

export const byAdmin: Context = { by: 'acme-admin', at };

export interface PublishedEvent {
  readonly id: string;
  readonly type: string;
  readonly time?: string;
  readonly data?: Json;
}

export interface DefinitionVersion {
  readonly name: string;
  readonly version: number;
  readonly triggers: readonly Trigger[];
  readonly when?: string;
}

export interface Written {
  readonly context: Context;
  readonly lineage: Lineage;
}

export async function recordedWith(store: LedgerStreams, stream: string, record: AnyRecord, written: Written) {
  const { version } = await store.read(stream);
  await Effect.runPromise(
    eventAppenderOf(store, AnyRecordSchema)(stream, [record], { expectedVersion: version, ...written }),
  );
}

export function recorded(store: LedgerStreams, stream: string, record: AnyRecord, context: Context = byAdmin) {
  return recordedWith(store, stream, record, { context, lineage: noLineage });
}

export function emittedContext(runId: string, workflow: string, depth: number): Context {
  return { ...byAdmin, runId, definitionType: 'workflow', definitionName: workflow, definitionVersion: 1, depth };
}

export function published(
  store: LedgerStreams,
  event: PublishedEvent,
  context: Context = byAdmin,
  playbookKey = alpha,
) {
  return recorded(
    store,
    `${playbookKey}events/${event.id}`,
    {
      type: 'event_published',
      data: { event: { specversion: '1.0', source: '/acme', time: at, ...event }, filled: [] },
    },
    context,
  );
}

export function publishedInTurn(store: LedgerStreams, events: readonly PublishedEvent[]): Promise<void> {
  return events.reduce<Promise<void>>((before, event) => before.then(() => published(store, event)), Promise.resolve());
}

export type TriggerFilter = Readonly<Record<string, Json>> & { readonly type: string };

export function eventTrigger(...filters: readonly TriggerFilter[]): Trigger {
  return {
    kind: 'event',
    reference: '/schedule/on',
    filters: filters.map((attributes, index) => ({
      reference: `/schedule/on/any/${index}`,
      type: attributes.type,
      attributes,
    })),
  };
}

export function cronTrigger(expression: string, zone: { readonly time_zone?: string } = {}): Trigger {
  return { kind: 'cron', reference: '/schedule/cron', expression, ...zone };
}

export function everyTrigger(milliseconds: number): Trigger {
  return { kind: 'every', reference: '/schedule/every', milliseconds };
}

export function definitionRecorded(
  store: LedgerStreams,
  { name, version, triggers, when = at }: DefinitionVersion,
  playbookKey = alpha,
) {
  const content = triggers.length === 0 ? { source: 'do: []' } : { source: 'schedule: {}', triggers };
  const [, , playbook = ''] = playbookKey.split('/');
  return recorded(
    store,
    definitionStreamNamed(name, playbookKey),
    version === 1
      ? {
          type: 'definition_created',
          data: { content, playbook, created_by: { id: 'acme-admin', name: 'acme-admin' } },
        }
      : { type: 'definition_updated', data: { content } },
    { ...byAdmin, at: when, definitionType: 'workflow', definitionName: name, definitionVersion: version },
  );
}

export function definitionRecordAt(name: string, position: number, playbookKey = alpha): string {
  return messageIdOf(definitionStreamNamed(name, playbookKey), position);
}

export function eventRecordOf(id: string, playbookKey = alpha): string {
  return messageIdOf(`${playbookKey}events/${id}`, 1);
}

export function definitionRetired(store: LedgerStreams, name: string, version: number) {
  return recorded(
    store,
    definitionStreamNamed(name),
    { type: 'definition_retired', data: {} },
    { ...byAdmin, definitionType: 'workflow', definitionName: name, definitionVersion: version },
  );
}

export function definitionMoved(store: LedgerStreams, name: string, version: number, to: string) {
  return recorded(
    store,
    definitionStreamNamed(name),
    { type: 'definition_moved', data: { from: 'alpha', to, moved_by: { id: 'acme-admin', name: 'acme-admin' } } },
    { ...byAdmin, definitionType: 'workflow', definitionName: name, definitionVersion: version },
  );
}

export interface StandingChange {
  readonly name: string;
  readonly version: number;
  readonly when: string;
}

export function definitionPaused(store: LedgerStreams, { name, version, when }: StandingChange) {
  return recorded(
    store,
    definitionStreamNamed(name),
    { type: 'definition_paused', data: { paused_by: { id: 'acme-admin', name: 'acme-admin' } } },
    { ...byAdmin, at: when, definitionType: 'workflow', definitionName: name, definitionVersion: version },
  );
}

export function definitionResumed(store: LedgerStreams, { name, version, when }: StandingChange) {
  return recorded(
    store,
    definitionStreamNamed(name),
    { type: 'definition_resumed', data: {} },
    { ...byAdmin, at: when, definitionType: 'workflow', definitionName: name, definitionVersion: version },
  );
}

export function playbookCreated(store: LedgerStreams, playbook: string) {
  return recorded(store, playbooksStreamOfOrg('acme'), {
    type: 'playbook_created',
    data: { playbook, name: playbook, description: '', created_by: { id: 'acme-admin', name: 'acme-admin' } },
  });
}

export interface RunOf {
  readonly runId: string;
  readonly type: string;
  readonly name: string;
  readonly depth?: number;
  readonly correlation?: string;
}

export async function definedOnce(store: LedgerStreams, definitionKey: string, type: string, name: string) {
  const stream = `${definitionKey}definitions/${type}`;
  if ((await store.read(stream)).version === 0) {
    await recorded(
      store,
      stream,
      {
        type: 'definition_created',
        data: {
          content: { source: 'do: []' },
          playbook: 'alpha',
          created_by: { id: 'acme-admin', name: 'acme-admin' },
        },
      },
      { ...byAdmin, definitionType: type, definitionName: name, definitionVersion: 1 },
    );
  }
}

export async function runRecorded(store: LedgerStreams, run: RunOf, ending?: 'run_succeeded') {
  const { runId, type, name, depth, correlation = runId } = run;
  const definitionKey = definitionKeyOfType(type, name);
  await definedOnce(store, definitionKey, type, name);
  const stream = `${definitionKey}runs/${runId}`;
  const context: Context = {
    ...byAdmin,
    runId,
    definitionType: type,
    definitionName: name,
    definitionVersion: 1,
    ...(depth === undefined ? {} : { depth }),
  };
  const lineage = { causationId: null, correlationId: correlation };
  await recordedWith(
    store,
    stream,
    {
      type: 'run_started',
      data: { started_by: { id: 'acme-admin', name: 'acme-admin' }, playbook: 'alpha', input: {} },
    },
    { context, lineage },
  );
  if (ending !== undefined) {
    await recordedWith(store, stream, { type: ending, data: { output: 'done', record: {} } }, { context, lineage });
  }
}

const definitionOfTheChildren = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-00000000c4ec/';

export function childStreamOf(child: string): string {
  return `${definitionOfTheChildren}runs/${child}`;
}

const startedByAdmin = {
  type: 'run_started',
  data: { started_by: { id: 'acme-admin', name: 'acme-admin' }, playbook: 'alpha', input: {} },
};

export async function testDefinitionsPlaced(store: LedgerStreams): Promise<void> {
  await definedOnce(store, definitionKeyOfTheTests, 'workflow', 'test');
  await definedOnce(store, definitionOfTheChildren, 'workflow', 'check');
}

export async function childStarted(store: LedgerStreams, child: string, context: Context = byAdmin): Promise<string> {
  const stream = childStreamOf(child);
  if ((await store.read(stream)).version === 0) {
    await recorded(store, stream, startedByAdmin, context);
  }
  return stream;
}

export async function runOfTheTestsStarted(store: LedgerStreams, runId: string): Promise<string> {
  const stream = `${definitionKeyOfTheTests}runs/${runId}`;
  await recorded(store, stream, startedByAdmin, {
    ...byAdmin,
    runId,
    definitionType: 'workflow',
    definitionName: 'test',
    definitionVersion: 1,
  });
  return stream;
}
