import type { AppendSignal } from '@on.auto/ledger';
import { streamPrefixOfPlaybook } from '@on.auto/operations';
import { unitMemoryBytes, workerStackBytes, type ProgramPool } from '@on.auto/workflow-engine/dsl';

import { someFolder, type SomeFolder } from '../projector/folder.ts';
import type { ProjectorSettings } from '../projector/projector-settings.ts';
import type { ViewDetails } from '../views/view-details.ts';
import type { KeptView } from '../views/view-rows.ts';
import { viewsFolder } from '../views/views-folder.ts';
import type { FoldingSettings, ViewsFolding } from '../views/views-folding.ts';
import { testFoldWorker } from './test-fold-workers.ts';

export interface Playbook {
  readonly org: string;
  readonly playbook: string;
}

export const alpha: Playbook = { org: 'acme', playbook: 'alpha' };

export const alphaKey = streamPrefixOfPlaybook(alpha);

export const viewTestTimeoutMs = 60_000;

export const succeeded = [{ type: 'run_succeeded' }];

export function detailsOf(fold: string, filters: ViewDetails['filters'], more: Partial<ViewDetails> = {}): ViewDetails {
  return { language: 'typescript', fold, foldLine: 30, filters, initial: {}, ...more };
}

export function foldOf(body: string): string {
  return `export function fold(view, event) {\n  ${body}\n}`;
}

export const counting = detailsOf(foldOf('return view + 1;'), succeeded, { initial: 0 });

export const collecting = detailsOf(foldOf('return [...view, event.data.output];'), succeeded, {
  initial: [],
});

export function foldingOf(): FoldingSettings {
  return {
    budget: 500,
    memoryBytes: unitMemoryBytes,
    stackBytes: workerStackBytes,
    foldDeadlineMs: 10_000,
    pageBudgetMs: 2000,
    mostViewBytes: 524_288,
    worker: testFoldWorker,
  };
}

export interface ViewsProjecting extends Omit<ProjectorSettings, 'folders'>, ViewsFolding {
  readonly besides: readonly SomeFolder[];
}

export type ViewSettingsOf = (more?: Partial<ViewsProjecting>) => ProjectorSettings;

export function viewsFolderOver(pool: ProgramPool, rebuildsAtOnce = 4) {
  return viewsFolder({
    definitionType: 'recall',
    pool,
    folding: foldingOf(),
    overtimesBeforeStall: 20,
    rebuildsAtOnce,
  });
}

export function settingsOver(pool: ProgramPool, appends: AppendSignal): ViewSettingsOf {
  return (more = {}) => {
    const settings: ViewsProjecting = {
      definitionType: 'recall',
      pool,
      folding: foldingOf(),
      playbooksAtOnce: 4,
      rebuildsAtOnce: 4,
      pagesPerWake: 10,
      overtimesBeforeStall: 20,
      appends,
      besides: [],
      ...more,
    };
    const {
      definitionType,
      folding,
      overtimesBeforeStall,
      rebuildsAtOnce,
      pool: folded,
      besides,
      ...projecting
    } = settings;
    const views = viewsFolder({ definitionType, pool: folded, folding, overtimesBeforeStall, rebuildsAtOnce });
    return { ...projecting, folders: [someFolder(views), ...besides] };
  };
}

export function isLive({ phase }: KeptView): boolean {
  return phase === 'live';
}

export function isStalled({ phase }: KeptView): boolean {
  return phase === 'stalled';
}

export function liveWith(folded: number): (view: KeptView) => boolean {
  return (view) => isLive(view) && view.folded === folded;
}

export function liveAt(version: number): (view: KeptView) => boolean {
  return (view) => isLive(view) && view.version === version;
}

export function foldedAll(folded: number): (view: KeptView) => boolean {
  return (view) => view.folded === folded;
}

export function liveFromSomewhere(view: KeptView): boolean {
  return isLive(view) && view.checkpoint !== null;
}
