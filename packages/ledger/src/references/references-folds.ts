import {
  addressedStreamOf,
  digestsChanged,
  digestsTouchedBy,
  heldOver,
  releasesEverything,
  type ContentHolders,
  type HeldDigests,
  type TypedEvent,
} from '@on.auto/operations';
import { payloadDigestsNamed } from '@on.auto/operations/payloads';

import type { StatementExecutor } from '../event-store.ts';
import { inTurn, type InlineProjection } from '../projections/inline-projection.ts';
import type { HeldTypes, ProjectionDialect, StreamsInOrder } from '../projections/projection-dialect.ts';
import { batchesFilledFrom, listingAfter, messagesInABatch, withinBytes } from '../projections/projection-fill.ts';
import { orderedMessagesIn, sizedPointsIn } from '../projections/projection-statements.ts';
import {
  digestsLockedInOrder,
  digestsWithoutAHead,
  heldDeleted,
  heldInTheStream,
  heldOfTheDigests,
  heldWritten,
  type ReferencesPlace,
} from './references-table.ts';

export interface ReferencesKeeping {
  readonly dialect: ProjectionDialect;
  readonly holders: ContentHolders;
  readonly mostBytes: number;
}

interface PlacedFact {
  readonly place: ReferencesPlace;
  readonly fact: TypedEvent;
}

function placeOf(stream: string): ReferencesPlace | undefined {
  const named = addressedStreamOf(stream);
  return named?.scope === 'playbook' ? { prefix: named.prefix, stream: `${named.kind}/${named.id}` } : undefined;
}

function placedOf(stream: string, fact: TypedEvent): readonly PlacedFact[] {
  const place = placeOf(stream);
  return place === undefined ? [] : [{ place, fact }];
}

function heldBefore(
  { dialect, holders }: ReferencesKeeping,
  execute: StatementExecutor,
  place: ReferencesPlace,
  facts: readonly TypedEvent[],
): Promise<HeldDigests> {
  if (facts.some((fact) => releasesEverything(holders, fact))) {
    return heldInTheStream(execute, dialect, place);
  }
  const digests = [...new Set(facts.flatMap((fact) => digestsTouchedBy(holders, fact)))];
  return heldOfTheDigests(execute, dialect, place, digests);
}

interface HoldsChanged {
  readonly place: ReferencesPlace;
  readonly after: HeldDigests;
  readonly changed: readonly string[];
}

function holdsChangedFrom(place: ReferencesPlace, before: HeldDigests, after: HeldDigests): HoldsChanged {
  return { place, after, changed: digestsChanged(before, after) };
}

async function changeWritten(
  { dialect }: ReferencesKeeping,
  execute: StatementExecutor,
  { place, after, changed }: HoldsChanged,
): Promise<void> {
  const held = changed.flatMap((sha256) => {
    const count = after.get(sha256) ?? 0;
    return count > 0 ? [{ sha256, held: count }] : [];
  });
  await heldWritten(execute, dialect, place, held);
  await heldDeleted(
    execute,
    place,
    changed.filter((sha256) => !after.has(sha256)),
  );
}

function changesLocked(
  { dialect }: ReferencesKeeping,
  execute: StatementExecutor,
  changes: readonly HoldsChanged[],
): Promise<void> {
  return digestsLockedInOrder(
    execute,
    dialect,
    changes.map(({ place, changed }) => ({ prefix: place.prefix, digests: changed })),
  );
}

interface FactsOfAStream {
  readonly place: ReferencesPlace;
  readonly facts: readonly TypedEvent[];
}

async function holdsChangedBy(
  keeping: ReferencesKeeping,
  execute: StatementExecutor,
  { place, facts }: FactsOfAStream,
): Promise<HoldsChanged> {
  const before = await heldBefore(keeping, execute, place, facts);
  return holdsChangedFrom(place, before, heldOver(keeping.holders, facts, before));
}

function byStream(placed: readonly PlacedFact[]): readonly FactsOfAStream[] {
  const streams = new Map<string, FactsOfAStream>();
  for (const { place, fact } of placed) {
    const key = `${place.prefix}${place.stream}`;
    streams.set(key, { place, facts: [...(streams.get(key)?.facts ?? []), fact] });
  }
  return [...streams.values()];
}

function placedFolded(
  keeping: ReferencesKeeping,
  execute: StatementExecutor,
  placed: readonly PlacedFact[],
): Promise<void> {
  return inTurn(byStream(placed), async (ofAStream) =>
    changeWritten(keeping, execute, await holdsChangedBy(keeping, execute, ofAStream)),
  );
}

async function placedKept(
  keeping: ReferencesKeeping,
  execute: StatementExecutor,
  placed: readonly PlacedFact[],
): Promise<void> {
  const changes: HoldsChanged[] = [];
  await inTurn(byStream(placed), async (ofAStream) => {
    changes.push(await holdsChangedBy(keeping, execute, ofAStream));
  });
  await changesLocked(keeping, execute, changes);
  await inTurn(changes, (change) => changeWritten(keeping, execute, change));
}

function payloadDigestsOf(
  { holders }: ReferencesKeeping,
  placed: readonly PlacedFact[],
): ReadonlyMap<string, readonly string[]> {
  const byPlaybook = new Map<string, readonly string[]>();
  for (const { place, fact } of placed) {
    byPlaybook.set(place.prefix, [...(byPlaybook.get(place.prefix) ?? []), ...payloadDigestsNamed(holders, fact)]);
  }
  return byPlaybook;
}

async function requirePayloadsHeaded(
  keeping: ReferencesKeeping,
  execute: StatementExecutor,
  placed: readonly PlacedFact[],
): Promise<void> {
  await inTurn(
    [...payloadDigestsOf(keeping, placed)],
    async ([prefix, digests]: readonly [string, readonly string[]]) => {
      const [unheaded] = digests.length === 0 ? [] : await digestsWithoutAHead(execute, prefix, digests);
      if (unheaded !== undefined) {
        throw new Error(
          `A fact names the payload ${unheaded} of ${prefix}, which the playbook's content does not keep; a payload is put before the fact that names it is appended`,
        );
      }
    },
  );
}

export function keepingReferences(keeping: ReferencesKeeping): InlineProjection {
  return {
    types: [...keeping.holders.keys()],
    handle: async (messages, execute) => {
      const placed = messages.flatMap(({ stream, type, data }) =>
        placedOf(stream, { type, data: keeping.dialect.appendedData(data) }),
      );
      await requirePayloadsHeaded(keeping, execute, placed);
      await placedKept(keeping, execute, placed);
    },
  };
}

type OrderedMessage = Awaited<ReturnType<typeof orderedMessagesIn>>[number];

interface BatchFolding {
  readonly streams: StreamsInOrder;
  readonly fold: (messages: readonly OrderedMessage[]) => Promise<void>;
}

function heldTypesOf(holders: ContentHolders): HeldTypes {
  const holding: string[] = [];
  const measured: string[] = [];
  for (const [type, { holds, releases, payloads = [] }] of holders) {
    const keepsPayloadsAlone = holds === undefined && releases === undefined && payloads.length > 0;
    (keepsPayloadsAlone ? measured : holding).push(type);
  }
  return { holding, measured };
}

interface HeldBatch {
  readonly after?: string;
  readonly listing: number;
}

const firstHeldBatch: HeldBatch = { listing: 1 };

async function batchFolded(
  keeping: ReferencesKeeping,
  execute: StatementExecutor,
  { streams, fold }: BatchFolding,
  { after, listing }: HeldBatch,
): Promise<HeldBatch | undefined> {
  const read = { after, count: listing, streams, types: heldTypesOf(keeping.holders) };
  const sized = await sizedPointsIn(execute, keeping.dialect.heldSizesInOrderAfter(read));
  const taken = withinBytes(sized, keeping.mostBytes);
  const through = taken.at(-1);
  const messages =
    through === undefined
      ? []
      : await orderedMessagesIn(execute, keeping.dialect.heldMessagesThrough(read, through.point));
  await fold(messages);
  const last = messages.at(-1);
  return last !== undefined && (taken.length < sized.length || sized.length === listing)
    ? {
        after: last.point,
        listing: listingAfter({ listing, most: messagesInABatch, mostBytes: keeping.mostBytes }, taken),
      }
    : undefined;
}

function foldedInBatches(
  keeping: ReferencesKeeping,
  execute: StatementExecutor,
  folding: BatchFolding,
  first: HeldBatch,
): Promise<void> {
  return batchesFilledFrom(first, (batch) => batchFolded(keeping, execute, folding, batch));
}

function factOf({ dialect }: ReferencesKeeping, { type, data }: OrderedMessage): TypedEvent {
  return { type, data: dialect.filledData(data) };
}

export function referencesFilled(keeping: ReferencesKeeping, execute: StatementExecutor): Promise<void> {
  return foldedInBatches(
    keeping,
    execute,
    {
      streams: { of: 'every' },
      fold: (messages) =>
        placedFolded(
          keeping,
          execute,
          messages.flatMap((message) => placedOf(message.stream, factOf(keeping, message))),
        ),
    },
    firstHeldBatch,
  );
}

export async function referencesRefolded(
  keeping: ReferencesKeeping,
  execute: StatementExecutor,
  stream: string,
): Promise<void> {
  const place = placeOf(stream);
  if (place === undefined) {
    return;
  }
  const facts: TypedEvent[] = [];
  await foldedInBatches(
    keeping,
    execute,
    {
      streams: { of: 'lane', lane: { by: 'stream', key: stream } },
      fold: (messages) => {
        facts.push(...messages.map((message) => factOf(keeping, message)));
        return Promise.resolve();
      },
    },
    firstHeldBatch,
  );
  const changed = holdsChangedFrom(
    place,
    await heldInTheStream(execute, keeping.dialect, place),
    heldOver(keeping.holders, facts),
  );
  await changesLocked(keeping, execute, [changed]);
  await changeWritten(keeping, execute, changed);
}
