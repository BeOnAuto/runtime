import type { Capability, PreparedDefinition, RunContext } from '@on.auto/definitions';
import { streamPrefixOfPlaybook } from '@on.auto/operations';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { comparePoints, type Point } from '../pages/history-points.ts';
import type { PassedRow, SomeFolder } from '../projector/folder.ts';

export interface FoldWaitBounds {
  readonly mostMs: number;
  readonly everyMs: number;
}

export const foldWaitBounds: FoldWaitBounds = { mostMs: 3_000, everyMs: 20 };

export interface FoldedBeforeRuns {
  readonly capability: Capability;
  readonly folders: readonly SomeFolder[];
  readonly database: HostDatabase;
  readonly bounds?: FoldWaitBounds;
}

function newestPointOf(database: HostDatabase, playbookKey: string): Effect.Effect<Point | undefined> {
  return Effect.promise(() =>
    database.store.readRecorded(playbookKey, { kind: 'everything' }, { order: 'desc', limit: 1 }),
  ).pipe(Effect.map(({ records: [newest] }) => newest?.point));
}

function isBehind({ phase, checkpoint }: PassedRow, through: Point): boolean {
  return phase === 'live' && comparePoints(checkpoint, through) < 0;
}

function anyBehind(
  { folders, database }: FoldedBeforeRuns,
  playbookKey: string,
  through: Point,
): Effect.Effect<boolean> {
  return Effect.orDie(
    Effect.forEach(folders, (some) =>
      some((folder) =>
        Effect.map(folder.rowsOf(database, playbookKey), (rows) => rows.some((row) => isBehind(row, through))),
      ),
    ),
  ).pipe(Effect.map((behind: readonly boolean[]) => behind.includes(true)));
}

function caughtUpWithin(behind: Effect.Effect<boolean>, tries: number, everyMs: number): Effect.Effect<void> {
  return Effect.flatMap(behind, (stillBehind) =>
    stillBehind && tries > 0
      ? Effect.andThen(Effect.sleep(everyMs), caughtUpWithin(behind, tries - 1, everyMs))
      : Effect.void,
  );
}

function caughtUp(waiting: FoldedBeforeRuns, { org, playbook }: RunContext): Effect.Effect<void> {
  const { mostMs, everyMs } = waiting.bounds ?? foldWaitBounds;
  const playbookKey = streamPrefixOfPlaybook({ org, playbook });
  return Effect.flatMap(newestPointOf(waiting.database, playbookKey), (through) =>
    through === undefined
      ? Effect.void
      : caughtUpWithin(anyBehind(waiting, playbookKey, through), Math.ceil(mostMs / everyMs), everyMs),
  );
}

function preparedOnceFolded(waiting: FoldedBeforeRuns, prepared: PreparedDefinition): PreparedDefinition {
  return {
    ...prepared,
    run: (input, context) => Effect.andThen(caughtUp(waiting, context), prepared.run(input, context)),
  };
}

export function foldedBeforeItRuns(waiting: FoldedBeforeRuns): Capability {
  const { capability, folders } = waiting;
  return folders.length === 0
    ? capability
    : {
        ...capability,
        prepare: (source, stripped) =>
          Effect.map(capability.prepare(source, stripped), (prepared) => preparedOnceFolded(waiting, prepared)),
      };
}
