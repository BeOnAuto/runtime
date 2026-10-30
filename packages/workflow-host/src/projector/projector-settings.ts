import type { AppendSignal } from '@on.auto/ledger';

import type { SomeFolder } from './folder.ts';

export interface ProjectorSettings {
  readonly folders: readonly SomeFolder[];
  readonly playbooksAtOnce: number;
  readonly pagesPerWake: number;
  readonly appends?: AppendSignal;
}
