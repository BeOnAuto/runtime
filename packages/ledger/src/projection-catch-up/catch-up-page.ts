import { addressedStreamOf, foldsStream, type ProjectionDeclaration } from '@on.auto/operations';
import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import { keptInOrder, listingAfter, messagesInABatch, withinBytes } from '../projections/projection-fill.ts';
import type { ProjectionKeeping } from '../projections/projection-keeping.ts';
import { orderedMessagesIn } from '../projections/projection-statements.ts';
import { catchingUpLocked, checkpointsAdvanced, rowOf, type CheckpointRow } from './catch-up-checkpoints.ts';

const factsInAWindow = 4096;

const ListedFacts = Schema.Array(
  Schema.Struct({ point: Schema.String, stream: Schema.String, type: Schema.String, size: Schema.Number }),
);

type ListedFact = (typeof ListedFacts.Type)[number];

export type PageFailed = (position: string) => void;

export interface CatchingUp {
  readonly dialect: ProjectionDialect;
  readonly keepings: readonly ProjectionKeeping[];
  readonly mostBytes: number;
  readonly failed: PageFailed;
}

export interface Page {
  readonly listing: number;
}

export interface PageDone {
  readonly next: Page | undefined;
  readonly caughtUp: readonly ProjectionKeeping[];
}

interface Behind {
  readonly keeping: ProjectionKeeping;
  readonly at: string;
}

interface Group {
  readonly keepings: readonly ProjectionKeeping[];
  readonly at: string;
  readonly through: string | undefined;
}

export function behindOf(keepings: readonly ProjectionKeeping[], rows: readonly CheckpointRow[]): readonly Behind[] {
  return keepings.flatMap((keeping): readonly Behind[] => {
    const at = rowOf(rows, keeping.projection)?.folded_through;
    return at === undefined || at === null ? [] : [{ keeping, at }];
  });
}

function groupOf({ orderOf }: ProjectionDialect['catchUp'], behind: readonly Behind[]): Group | undefined {
  const sorted = behind.toSorted((left, right) => {
    const [first, second] = [orderOf(left.at), orderOf(right.at)];
    return Number(first > second) - Number(first < second);
  });
  const lowest = sorted[0]?.at;
  if (lowest === undefined) {
    return undefined;
  }
  const atTheLowest = (at: string) => orderOf(at) === orderOf(lowest);
  return {
    keepings: sorted.filter(({ at }) => atTheLowest(at)).map(({ keeping }) => keeping),
    at: lowest,
    through: sorted.find(({ at }) => !atTheLowest(at))?.at,
  };
}

export function foldsFact(
  projection: ProjectionDeclaration,
  { stream, type }: Pick<ListedFact, 'stream' | 'type'>,
): boolean {
  const named = addressedStreamOf(stream);
  return named !== undefined && foldsStream(projection, named) && projection.types.includes(type);
}

async function foldedInto(
  { dialect }: CatchingUp,
  execute: StatementExecutor,
  group: readonly ProjectionKeeping[],
  taken: readonly ListedFact[],
): Promise<void> {
  if (taken.length === 0) {
    return;
  }
  const facts = await orderedMessagesIn(execute, dialect.catchUp.factsAt(taken.map(({ point }) => point)));
  await inTurn(group, async (keeping) => {
    const folded = facts.filter((fact) => foldsFact(keeping.projection, fact));
    if (folded.length > 0) {
      await keptInOrder(keeping, execute, folded);
    }
  });
}

interface Reach {
  readonly window: readonly ListedFact[];
  readonly folded: readonly ListedFact[];
  readonly taken: readonly ListedFact[];
}

interface Reached {
  readonly point: string | null;
  readonly seen: readonly ListedFact[];
  readonly listing: number;
}

function reachedOf({ window, folded, taken }: Reach, { through }: Group, { listing }: Page): Reached {
  const lastTaken = taken.at(-1);
  if (lastTaken !== undefined && taken.length < folded.length) {
    const seen = window.slice(0, window.indexOf(lastTaken) + 1);
    return { point: lastTaken.point, seen, listing: seen.length };
  }
  const lastListed = window.at(-1);
  if (lastListed !== undefined && (window.length === listing || through === undefined)) {
    return { point: lastListed.point, seen: window, listing };
  }
  return { point: through ?? null, seen: window, listing };
}

function pageAfter({ seen, listing }: Reached, mostBytes: number): Page {
  return { listing: seen.length === 0 ? listing : listingAfter({ listing, most: factsInAWindow, mostBytes }, seen) };
}

async function groupAdvanced(
  catching: CatchingUp,
  execute: StatementExecutor,
  group: Group,
  page: Page,
): Promise<PageDone> {
  const { dialect, mostBytes } = catching;
  const read = await execute.query(
    dialect.catchUp.window({ after: group.at, through: group.through, count: page.listing }),
  );
  const window = Schema.decodeUnknownSync(ListedFacts)(read.rows);
  const folded = window.filter((fact) => group.keepings.some(({ projection }) => foldsFact(projection, fact)));
  const taken = withinBytes(folded.slice(0, messagesInABatch), mostBytes);
  await foldedInto(catching, execute, group.keepings, taken);
  const reached = reachedOf({ window, folded, taken }, group, page);
  await execute.command(
    checkpointsAdvanced(
      dialect,
      group.keepings.map(({ projection }) => projection),
      reached.point,
    ),
  );
  return { next: pageAfter(reached, mostBytes), caughtUp: reached.point === null ? group.keepings : [] };
}

export async function pageCaughtUp(catching: CatchingUp, execute: StatementExecutor, page: Page): Promise<PageDone> {
  const group = groupOf(
    catching.dialect.catchUp,
    behindOf(catching.keepings, await catchingUpLocked(execute, catching.dialect)),
  );
  if (group === undefined) {
    return { next: undefined, caughtUp: [] };
  }
  try {
    return await groupAdvanced(catching, execute, group, page);
  } catch (failure) {
    catching.failed(group.at);
    throw failure;
  }
}
