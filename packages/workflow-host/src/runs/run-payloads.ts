import {
  noSharedPayloads,
  payloadKept,
  payloadReaderOf,
  payloadReadsAtOnce,
  PayloadOffloading,
  PayloadsShared,
  type PayloadNotRead,
  type PayloadReader,
  type PayloadSource,
  type SharedPayloads,
} from '@on.auto/operations/payloads';
import {
  ContentUnavailable,
  mostInlineHeldValueBytes,
  type HeldContent,
  type RunPayloads,
} from '@on.auto/workflow-engine';
import { Context, Deferred, Effect } from 'effect';

import type { FactPayloads } from '../follower/followed-events.ts';
import type { HostNote } from '../host/host-reports.ts';
import { addressOfRun } from './run-address.ts';

type Owner = PayloadSource['owner'];

type Kept = Parameters<RunPayloads<never>['read']>[1][number];

export const hostPayloadCacheBytes = 64 * 1_048_576;

export const HeldValueSizeThreshold = Context.Reference<number>('@on.auto/workflow-host/HeldValueSizeThreshold', {
  defaultValue: () => mostInlineHeldValueBytes,
});

interface HostPayloadParts {
  readonly content: PayloadSource['content'] & Parameters<typeof payloadKept>[0];
  readonly payloadOffloading: boolean;
  readonly payloadSizeThreshold: number;
  readonly shared: SharedPayloads;
  readonly note: (note: Extract<HostNote, { readonly kind: 'payloads_read' }>) => Effect.Effect<void>;
  readonly readerOf?: (source: PayloadSource) => PayloadReader;
}

function ownerOf(runKey: string): Owner {
  const { org, playbook } = addressOfRun(runKey);
  return { org, playbook };
}

function contentOf(read: Effect.Effect<string, PayloadNotRead>): Effect.Effect<HeldContent, ContentUnavailable> {
  return read.pipe(
    Effect.map((text): HeldContent => ({ kind: 'read', text })),
    Effect.catchTags({
      payload_missing: () => Effect.succeed<HeldContent>({ kind: 'missing' }),
      payload_erased: () => Effect.succeed<HeldContent>({ kind: 'erased' }),
      unavailable: (unavailable: Readonly<{ detail: string }>) => Effect.fail(unavailableOf(unavailable)),
    }),
  );
}

function unavailableOf({ detail }: Readonly<{ detail: string }>): ContentUnavailable {
  return new ContentUnavailable({ detail });
}

function mergedReads(): (
  key: string,
  read: Effect.Effect<HeldContent, ContentUnavailable>,
) => Effect.Effect<HeldContent, ContentUnavailable> {
  const reading = new Map<string, Deferred.Deferred<HeldContent, ContentUnavailable>>();
  return (key, read) =>
    Effect.suspend(() => {
      const already = reading.get(key);
      if (already !== undefined) {
        return Deferred.await(already);
      }
      const answered = Deferred.makeUnsafe<HeldContent, ContentUnavailable>();
      reading.set(key, answered);
      return Deferred.into(read, answered).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            reading.delete(key);
          }),
        ),
        Effect.andThen(Deferred.await(answered)),
      );
    });
}

function textBytesRead(contents: ReadonlyMap<string, HeldContent>, kept: readonly Kept[]): number {
  return kept.reduce((sum, { sha256, bytes }) => (contents.get(sha256)?.kind === 'read' ? sum + bytes : sum), 0);
}

export function hostRunPayloadsOf({
  content,
  payloadOffloading,
  payloadSizeThreshold,
  shared,
  note,
  readerOf = payloadReaderOf,
}: HostPayloadParts): RunPayloads<ContentUnavailable> {
  const merged = mergedReads();
  const { cache, gate } = shared;
  const readOne = (owner: Owner, kept: Kept): Effect.Effect<HeldContent, ContentUnavailable> =>
    merged(
      JSON.stringify([owner.org, owner.playbook, kept.sha256]),
      contentOf(readerOf({ owner, content, cache, gate }).text(kept)),
    );
  return {
    payloadOffloading,
    payloadSizeThreshold,
    read: (runKey, kept) => {
      const owner = ownerOf(runKey);
      return Effect.forEach(kept, (each) => Effect.map(readOne(owner, each), (read) => [each.sha256, read] as const), {
        concurrency: payloadReadsAtOnce,
      }).pipe(
        Effect.map((read: readonly (readonly [string, HeldContent])[]) => new Map(read)),
        Effect.tap((contents) =>
          note({
            kind: 'payloads_read',
            run: addressOfRun(runKey),
            texts: kept.length,
            bytes: textBytesRead(contents, kept),
            unread: kept.filter(({ sha256 }) => contents.get(sha256)?.kind !== 'read').length,
          }),
        ),
      );
    },
    keep: (runKey, payloads) => {
      const owner = ownerOf(runKey);
      return Effect.forEach(payloads, (payload) => payloadKept(content, owner, payload, { cache, gate }), {
        concurrency: payloadReadsAtOnce,
        discard: true,
      }).pipe(Effect.mapError(unavailableOf));
    },
  };
}

export function factPayloadsIn(
  content: PayloadSource['content'],
  { cache, gate }: SharedPayloads = noSharedPayloads,
): FactPayloads {
  return ({ org, playbook }) => payloadReaderOf({ owner: { org, playbook }, content, cache, gate });
}

export interface ComposedPayloads extends Pick<HostPayloadParts, 'content' | 'note'> {
  readonly context: Context.Context<never> | undefined;
}

export interface HostPayloads {
  readonly runs: RunPayloads<ContentUnavailable>;
  readonly factsOf: FactPayloads;
}

export function hostPayloadsOf({ content, context = Context.empty(), note }: ComposedPayloads): HostPayloads {
  const payloadOffloading = Context.get(context, PayloadOffloading);
  const payloadSizeThreshold = Context.get(context, HeldValueSizeThreshold);
  const shared = Context.get(context, PayloadsShared);
  return {
    runs: hostRunPayloadsOf({ content, payloadOffloading, payloadSizeThreshold, shared, note }),
    factsOf: factPayloadsIn(content, shared),
  };
}
