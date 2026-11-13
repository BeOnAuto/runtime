import { createHash } from 'node:crypto';

import {
  jsonPayloadText,
  sharedPayloadsWithin,
  type PayloadSource,
  type PayloadToKeep,
  type SharedPayloads,
} from '@on.auto/operations/payloads';
import { memoryLedger } from '@on.auto/operations/testing';
import type { ContentUnavailable, RunPayloads } from '@on.auto/workflow-engine';
import { Deferred, Effect, Exit, type Schema } from 'effect';

import type { HostNote } from '../host/host-reports.ts';
import { hostPayloadCacheBytes, hostRunPayloadsOf } from '../runs/run-payloads.ts';

type Content = PayloadSource['content'] & Parameters<typeof hostRunPayloadsOf>[0]['content'];

const utf8 = new TextEncoder();

export function keptOf(value: Schema.Json): PayloadToKeep {
  const { text, mediaType } = jsonPayloadText(value);
  return {
    text,
    mediaType,
    sha256: createHash('sha256').update(text).digest('hex'),
    bytes: utf8.encode(text).byteLength,
  };
}

interface NotesKept {
  readonly note: (note: HostNote) => Effect.Effect<void>;
  readonly notes: () => readonly HostNote[];
}

export function notesKept(): NotesKept {
  const notes: HostNote[] = [];
  return {
    note: (note) =>
      Effect.sync(() => {
        notes.push(note);
      }),
    notes: () => notes,
  };
}

interface Held {
  readonly release: () => void;
}

export interface StoreOfPayloads {
  readonly payloads: RunPayloads<ContentUnavailable>;
  readonly content: Content;
  readonly gets: () => number;
  readonly notes: () => readonly HostNote[];
  readonly down: (isDown: boolean) => void;
  readonly hold: () => Held;
  readonly whenAsked: () => Promise<void>;
}

const refused = () => Effect.die(new Error('connect ECONNREFUSED'));

export function storeOn(
  payloadOffloading = true,
  shared: SharedPayloads = sharedPayloadsWithin(hostPayloadCacheBytes),
): StoreOfPayloads {
  const { content: kept } = memoryLedger().service;
  const { note, notes } = notesKept();
  let gets = 0;
  let isDown = false;
  let held = Deferred.makeUnsafe<void>();
  let asked = Promise.withResolvers<void>();
  Effect.runSync(Deferred.done(held, Exit.void));
  const reached = <A, E>(call: Effect.Effect<A, E>) => Effect.suspend(() => (isDown ? refused() : call));
  const content: Content = {
    put: (owner, given) => reached(kept.put(owner, given)),
    getHead: (owner, sha256) => reached(kept.getHead(owner, sha256)),
    get: (owner, sha256) =>
      Effect.suspend(() => {
        gets += 1;
        asked.resolve();
        return reached(Effect.andThen(Deferred.await(held), kept.get(owner, sha256)));
      }),
  };
  return {
    payloads: hostRunPayloadsOf({ content, payloadOffloading, shared, note }),
    content,
    gets: () => gets,
    notes,
    down: (down) => {
      isDown = down;
    },
    hold: () => {
      held = Deferred.makeUnsafe<void>();
      asked = Promise.withResolvers<void>();
      const holding = held;
      return {
        release: () => {
          Effect.runSync(Deferred.done(holding, Exit.void));
        },
      };
    },
    whenAsked: () => asked.promise,
  };
}

interface Streamed {
  readonly payloads: RunPayloads<ContentUnavailable>;
  readonly chunks: () => number;
}

export function streamedIn(toKeep: PayloadToKeep, size: number): Streamed {
  const bytes = utf8.encode(toKeep.text);
  let chunks = 0;
  const content: Content = {
    ...memoryLedger().service.content,
    get: () =>
      Effect.sync(() => {
        let at = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull: (controller) => {
            if (at >= bytes.byteLength) {
              controller.close();
              return;
            }
            chunks += 1;
            controller.enqueue(bytes.slice(at, at + size));
            at += size;
          },
        });
        return { stream, bytes: bytes.byteLength, mediaType: toKeep.mediaType };
      }),
  };
  const payloads = hostRunPayloadsOf({
    content,
    payloadOffloading: true,
    shared: sharedPayloadsWithin(0),
    note: () => Effect.void,
  });
  return { payloads, chunks: () => chunks };
}
