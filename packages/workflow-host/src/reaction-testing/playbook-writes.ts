import type { Trigger } from '@on.auto/definitions';
import { eventAppenderOf, type LedgerStreams } from '@on.auto/ledger';
import { ContextSchema, messageIdOf, noLineage, type Context, type Decided, type Lineage } from '@on.auto/operations';
import { playbooksStreamOfOrg } from '@on.auto/playbooks';
import type { Json } from '@on.auto/workflow-engine';
import { Effect, Schema } from 'effect';

export const alpha = 'playbook/acme/alpha/';

export const at = '2026-10-01T09:00:00.000Z';

const AnyRecordSchema = Schema.Struct({ type: Schema.String, data: Schema.JsonObject, context: ContextSchema });

type AnyRecord = Decided<typeof AnyRecordSchema.Type>;

export const byAdmin: Context = { by: 'acme-admin', at };

export interface PublishedEvent {
  readonly id: string;
  readonly type: string;
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

export function cronTrigger(expression: string): Trigger {
  return { kind: 'cron', reference: '/schedule/cron', expression };
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
  return recorded(
    store,
    `${playbookKey}definitions/workflow`,
    version === 1
      ? { type: 'definition_created', data: { content, created_by: { id: 'acme-admin', name: 'acme-admin' } } }
      : { type: 'definition_updated', data: { content } },
    { ...byAdmin, at: when, definitionType: 'workflow', definitionName: name, definitionVersion: version },
  );
}

export function definitionRecordAt(position: number, playbookKey = alpha): string {
  return messageIdOf(`${playbookKey}definitions/workflow`, position);
}

export function eventRecordOf(id: string, playbookKey = alpha): string {
  return messageIdOf(`${playbookKey}events/${id}`, 1);
}

export function definitionRetired(store: LedgerStreams, name: string, version: number) {
  return recorded(
    store,
    `${alpha}definitions/workflow`,
    { type: 'definition_retired', data: {} },
    { ...byAdmin, definitionType: 'workflow', definitionName: name, definitionVersion: version },
  );
}

export function playbookCreated(store: LedgerStreams, playbook: string) {
  return recorded(store, playbooksStreamOfOrg('acme'), {
    type: 'playbook_created',
    data: { playbook, name: playbook, description: '', created_by: { id: 'acme-admin', name: 'acme-admin' } },
  });
}

export function playbookRenamed(store: LedgerStreams, playbook: string) {
  return recorded(store, playbooksStreamOfOrg('acme'), {
    type: 'playbook_updated',
    data: { playbook, name: 'Renamed' },
  });
}

export interface RunOf {
  readonly runId: string;
  readonly type: string;
  readonly name: string;
  readonly depth?: number;
  readonly correlation?: string;
}

export async function runRecorded(store: LedgerStreams, run: RunOf, ending?: 'run_succeeded') {
  const { runId, type, name, depth, correlation = runId } = run;
  const stream = `${alpha}runs/${runId}`;
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
    { type: 'run_started', data: { started_by: { id: 'acme-admin', name: 'acme-admin' }, input: {} } },
    { context, lineage },
  );
  if (ending !== undefined) {
    await recordedWith(store, stream, { type: ending, data: { output: 'done', record: {} } }, { context, lineage });
  }
}
