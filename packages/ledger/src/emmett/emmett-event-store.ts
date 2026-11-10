import { DeadlockError, DumboError } from '@event-driven-io/dumbo';
import {
  isExpectedVersionConflictError,
  type Event,
  type EventStore as EmmettEventStore,
} from '@event-driven-io/emmett';
import {
  contextOf,
  messageIdOf,
  noLineage,
  type ContentHolders,
  type Context,
  type Lineage,
} from '@on.auto/operations';
import type { Schema } from 'effect';

import { requireHeldAsMeasured } from '../appends/payloads-declared.ts';
import { mostMessagesInAStreamPage, pageCutOf, type SizesAfter } from '../appends/stream-pages.ts';
import type {
  AppendListeners,
  AppendPlace,
  EncodedEvent,
  MessageLineage,
  RecordedMessage,
  StreamStore,
  Streams,
} from '../event-store.ts';
import { appendRiders, type AppendRiders, type Rider } from '../scrub/append-riders.ts';
import { signalOf } from '../signal/append-signal.ts';
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
  readonly sizesAfter?: SizesAfter;
  readonly holders?: ContentHolders | undefined;
  readonly riders?: AppendRiders;
}

export interface RiddenAppends {
  readonly appendWithin: (
    stream: string,
    events: readonly EncodedEvent[],
    place: AppendPlace,
    rider: Rider,
  ) => Promise<void>;
}

export const rodeNowhere = 'The store appended the fact without running the work that rides on it before its commit';

export const dataAsWritten: StoredData<Schema.JsonObject> = {
  stored: (data) => data,
  read: (data) => data,
};

type StoredMetadata = Context & {
  readonly messageId: string;
  readonly causationId?: string | null;
  readonly correlationId?: string | null;
  readonly payloadBytes?: number;
};

function lineageOf({ messageId, causationId = null, correlationId = null }: StoredMetadata): MessageLineage {
  return { id: messageId, causationId, correlationId };
}

function metadataOf(
  messageId: string,
  { causationId, correlationId }: Lineage,
  context: Context,
  { payloadBytes }: EncodedEvent,
): StoredMetadata {
  return {
    messageId,
    causationId,
    correlationId,
    ...context,
    ...(payloadBytes === undefined ? {} : { payloadBytes }),
  };
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

interface PlacedMessage<Stored extends Record<string, unknown>> {
  readonly type: string;
  readonly data: Stored;
  readonly metadata: StoredMetadata;
}

function messagesOf<Stored extends Record<string, unknown>>(
  data: StoredData<Stored>,
  stream: string,
  events: readonly EncodedEvent[],
  { expectedVersion, context, lineage = noLineage }: AppendPlace,
): readonly PlacedMessage<Stored>[] {
  return events.map((event, index) => ({
    type: event.type,
    data: data.stored(event.data),
    metadata: metadataOf(messageIdOf(stream, expectedVersion + index + 1), lineage, context, event),
  }));
}

const utf8 = new TextEncoder();

function sizesReadWhole<Stored extends Record<string, unknown>>(
  store: EmmettStore,
  data: StoredData<Stored>,
): SizesAfter {
  return async (stream, after, count) => {
    const { events } = await store.readStream<Event<string, Stored, StoredMetadata>>(stream, {
      from: BigInt(after + 1),
      to: BigInt(after + count),
    });
    return events.map(
      (event: { readonly data: Stored; readonly metadata: StoredMetadata & { readonly streamPosition: bigint } }) => ({
        position: Number(event.metadata.streamPosition),
        size: utf8.encode(JSON.stringify(data.read(event.data))).byteLength + (event.metadata.payloadBytes ?? 0),
      }),
    );
  };
}

function heldAsMeasured(
  holders: ContentHolders,
  stream: string,
  events: readonly EncodedEvent[],
): readonly EncodedEvent[] {
  for (const event of events) {
    requireHeldAsMeasured(holders, stream, event);
  }
  return events;
}

function isADeadlock(error: unknown): boolean {
  return DumboError.isInstanceOf(error, { errorType: DeadlockError.ErrorType });
}

async function appendedTo<Stored extends Record<string, unknown>>(
  store: EmmettStore,
  stream: string,
  messages: readonly PlacedMessage<Stored>[],
  { expectedVersion, context, lineage = noLineage }: AppendPlace,
): Promise<void> {
  try {
    await store.appendToStream(stream, [...messages], {
      expectedStreamVersion: BigInt(expectedVersion),
      observability: observabilityOf(lineage, context),
    });
  } catch (error) {
    if (isExpectedVersionConflictError(error) || isADeadlock(error)) {
      throw new VersionConflict();
    }
    throw error;
  }
}

async function appendedCarrying<Stored extends Record<string, unknown>>(
  appended: () => Promise<void>,
  messages: readonly PlacedMessage<Stored>[],
  riders: AppendRiders,
  rider: Rider,
): Promise<void> {
  const unridden = riders.ridden(
    messages.slice(-1).map(({ data }) => data),
    rider,
  );
  try {
    await appended();
  } catch (error) {
    unridden();
    throw error;
  }
  if (!unridden()) {
    throw new Error(rodeNowhere);
  }
}

type ReadEvent<Stored extends Record<string, unknown>> = {
  readonly type: string;
  readonly data: Stored;
  readonly metadata: StoredMetadata;
};

function readsOf<Stored extends Record<string, unknown>>(
  store: EmmettStore,
  data: StoredData<Stored>,
  sizesAfter: SizesAfter,
): Pick<Streams, 'read' | 'readPage'> {
  const recorded = recordedMessageOf(data);
  return {
    read: async (stream, after = 0) => {
      const { currentStreamVersion, events } = await store.readStream<Event<string, Stored, StoredMetadata>>(stream, {
        from: BigInt(after + 1),
      });
      return {
        version: Math.max(after, Number(currentStreamVersion)),
        messages: events.map((event: ReadEvent<Stored>) => recorded(event)),
      };
    },
    readPage: async (stream, after, mostBytes) => {
      const sized = await sizesAfter(stream, after, mostMessagesInAStreamPage + 1);
      const { through, more } = pageCutOf(sized, after, mostBytes);
      if (through === after) {
        return { messages: [], through, more };
      }
      const { events } = await store.readStream<Event<string, Stored, StoredMetadata>>(stream, {
        from: BigInt(after + 1),
        to: BigInt(through),
      });
      return { messages: events.map((event: ReadEvent<Stored>) => recorded(event)), through, more };
    },
  };
}

export function emmettEventStore<Stored extends Record<string, unknown>>(
  store: EmmettStore,
  {
    data,
    mostEventsInOneAppend,
    sizesAfter = sizesReadWhole(store, data),
    observer,
    holders = new Map(),
    riders = appendRiders(),
    ...listeners
  }: EmmettEventStoreOptions<Stored>,
): StreamStore & RiddenAppends {
  const signal = signalOf(listeners);
  const announced = (
    stream: string,
    events: readonly EncodedEvent[],
    { lineage = noLineage, ...place }: AppendPlace,
  ) => {
    signal.raise(stream);
    observer?.appended(stream, events, { ...place, lineage });
  };
  return {
    mostEventsInOneAppend,
    ...readsOf(store, data, sizesAfter),
    append: async (stream, events, place) => {
      await appendedTo(store, stream, messagesOf(data, stream, heldAsMeasured(holders, stream, events), place), place);
      announced(stream, events, place);
    },
    appendWithin: async (stream, events, place, rider) => {
      const messages = messagesOf(data, stream, heldAsMeasured(holders, stream, events), place);
      await appendedCarrying(() => appendedTo(store, stream, messages, place), messages, riders, rider);
      announced(stream, events, place);
    },
    migrate: async () => {
      await store.schema.migrate();
    },
    close: () => store.close(),
  };
}
