import {
  isExpectedVersionConflictError,
  type Event,
  type EventStore as EmmettEventStore,
} from '@event-driven-io/emmett';
import { contextOf, messageIdOf, noLineage, type Context, type Lineage } from '@on.auto/operations';
import type { Schema } from 'effect';

import type { AppendListeners, MessageLineage, RecordedMessage, StreamStore } from '../event-store.ts';
import { streamAppends } from '../signal/append-signal.ts';
import { VersionConflict } from '../version-conflict.ts';

export interface EmmettStore extends Pick<EmmettEventStore, 'readStream' | 'appendToStream'> {
  readonly schema: { readonly migrate: () => Promise<unknown> };
  readonly close: () => Promise<void>;
}

export interface StoredData<Stored extends Record<string, unknown>> {
  readonly stored: (data: Schema.JsonObject) => Stored;
  readonly read: (stored: Stored) => unknown;
}

export interface EmmettEventStoreOptions<Stored extends Record<string, unknown>> extends AppendListeners {
  readonly data: StoredData<Stored>;
  readonly mostEventsInOneAppend: number;
}

export const dataAsWritten: StoredData<Schema.JsonObject> = {
  stored: (data) => data,
  read: (data) => data,
};

type StoredMetadata = Context & {
  readonly messageId: string;
  readonly causationId?: string | null;
  readonly correlationId?: string | null;
};

function lineageOf({ messageId, causationId = null, correlationId = null }: StoredMetadata): MessageLineage {
  return { id: messageId, causationId, correlationId };
}

function metadataOf(messageId: string, { causationId, correlationId }: Lineage, context: Context): StoredMetadata {
  return { messageId, causationId, correlationId, ...context };
}

function observabilityOf({ causationId, correlationId }: Lineage, { runId }: Context) {
  return {
    context: {
      ...(causationId === null ? {} : { causationId }),
      ...(correlationId === null ? {} : { correlationId }),
    },
    attributes: runId === undefined ? {} : { 'auto.on.run_id': runId },
  };
}

function recordedMessageOf<Stored extends Record<string, unknown>>(
  data: StoredData<Stored>,
): (event: { readonly type: string; readonly data: Stored; readonly metadata: StoredMetadata }) => RecordedMessage {
  return (event) => ({
    type: event.type,
    data: data.read(event.data),
    context: contextOf(event.metadata),
    lineage: lineageOf(event.metadata),
  });
}

export function emmettEventStore<Stored extends Record<string, unknown>>(
  store: EmmettStore,
  { data, mostEventsInOneAppend, appended = streamAppends, observer }: EmmettEventStoreOptions<Stored>,
): StreamStore {
  const recorded = recordedMessageOf(data);
  return {
    mostEventsInOneAppend,
    read: async (stream, after = 0) => {
      const { currentStreamVersion, events } = await store.readStream<Event<string, Stored, StoredMetadata>>(stream, {
        from: BigInt(after + 1),
      });
      return {
        version: Math.max(after, Number(currentStreamVersion)),
        messages: events.map(
          (event: { readonly type: string; readonly data: Stored; readonly metadata: StoredMetadata }) =>
            recorded(event),
        ),
      };
    },
    append: async (stream, events, { expectedVersion, context, lineage = noLineage }) => {
      try {
        await store.appendToStream(
          stream,
          events.map((event, index) => ({
            type: event.type,
            data: data.stored(event.data),
            metadata: metadataOf(messageIdOf(stream, expectedVersion + index + 1), lineage, context),
          })),
          { expectedStreamVersion: BigInt(expectedVersion), observability: observabilityOf(lineage, context) },
        );
      } catch (error) {
        if (isExpectedVersionConflictError(error)) {
          throw new VersionConflict();
        }
        throw error;
      }
      appended.raise(stream);
      observer?.appended(stream, events, { expectedVersion, context, lineage });
    },
    migrate: async () => {
      await store.schema.migrate();
    },
    close: () => store.close(),
  };
}
