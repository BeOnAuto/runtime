import { Effect } from 'effect';

import type { DatabaseFailed, HostDatabase } from '../database/host-database.ts';
import type { HostNote } from '../host/host-reports.ts';
import { comparePoints, earliestOf, type Point } from '../pages/history-points.ts';
import {
  folderPassOf,
  readFor,
  type FolderParts,
  type FolderPass,
  type LiveRead,
  type Resting,
} from './folder-pass.ts';
import type { ProjectorSettings } from './projector-settings.ts';
import type { KeptDefinitions } from './reconciled-rows.ts';

export interface PassParts {
  readonly database: HostDatabase;
  readonly note: (note: HostNote) => Effect.Effect<void>;
  readonly settings: ProjectorSettings;
  readonly definitions: KeptDefinitions;
  readonly resting: Resting;
  readonly firstSeen: (record: string) => boolean;
  readonly trouble: (what: string) => Effect.Effect<void>;
}

interface Sharing {
  readonly pass: FolderPass;
  readonly live: LiveRead;
}

interface SharedRead {
  readonly after: Point | undefined;
  readonly sharing: readonly Sharing[];
}

function sharingNow(passes: readonly FolderPass[]): readonly Sharing[] {
  return passes.flatMap((pass) => {
    const live = pass.live();
    return live === undefined ? [] : [{ pass, live }];
  });
}

function earliestRead(sharing: readonly Sharing[]): SharedRead {
  const after = earliestOf(sharing.map(({ live }) => live.after));
  return { after, sharing: sharing.filter(({ live }) => comparePoints(live.after, after) === 0) };
}

function sharedSteps(
  parts: FolderParts,
  playbook: string,
  passes: readonly FolderPass[],
  pages: number,
): Effect.Effect<number, DatabaseFailed> {
  const sharing = sharingNow(passes);
  if (sharing.length === 0 || pages === 0) {
    return Effect.succeed(pages);
  }
  const read = earliestRead(sharing);
  return Effect.gen(function* () {
    const page = yield* readFor(parts, playbook, {
      after: read.after,
      types: read.sharing.flatMap(({ live }) => live.types),
    });
    yield* Effect.forEach(read.sharing, ({ pass }) => pass.foldShared(page), { discard: true });
    return yield* sharedSteps(parts, playbook, passes, pages - 1);
  });
}

function folderPartsOf({ database, settings, definitions, note, resting, firstSeen, trouble }: PassParts): FolderParts {
  return {
    database,
    definitions,
    note,
    resting,
    firstSeen,
    trouble,
    definitionTypes: settings.folders.map((some) => some((folder) => folder.definitionType)),
  };
}

export function playbookPass(parts: PassParts, playbook: string): Effect.Effect<boolean, DatabaseFailed> {
  const folderParts = folderPartsOf(parts);
  return Effect.gen(function* () {
    const passes = yield* Effect.forEach(parts.settings.folders, (some) =>
      some((folder) => folderPassOf(folder, folderParts, playbook)),
    );
    const shared = yield* sharedSteps(folderParts, playbook, passes, parts.settings.pagesPerWake);
    const left = yield* Effect.reduce(
      passes,
      () => shared,
      (pages, pass) => pass.rebuild(pages),
    );
    return !passes.some((pass) => pass.again()) && (left === 0 || passes.some((pass) => pass.canBuild()));
  });
}
