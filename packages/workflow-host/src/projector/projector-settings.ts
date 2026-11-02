import type { AppendSignal } from '@on.auto/ledger';

import type { SomeFolder } from './folder.ts';
import type { KeptOf } from './playbook-definitions.ts';

export interface KeptAlong {
  readonly definitionType: string;
  readonly keptOf: KeptOf;
  readonly keyOf: (name: string) => string;
}

export type KeptAlongBy = Readonly<Record<string, readonly KeptAlong[]>>;

export interface ProjectorSettings {
  readonly folders: readonly SomeFolder[];
  readonly playbooksAtOnce: number;
  readonly pagesPerWake: number;
  readonly appends?: AppendSignal;
  readonly keptAlong?: KeptAlongBy;
}

export function keptAlongWith(keptAlong: KeptAlongBy, definitionType: string): readonly KeptAlong[] {
  return Object.entries(keptAlong)
    .filter(([keptBy]: readonly [string, readonly KeptAlong[]]) => keptBy === definitionType)
    .flatMap(([, along]: readonly [string, readonly KeptAlong[]]) => along);
}

export function definitionTypesKeptBy(keptAlong: KeptAlongBy, definitionType: string): readonly string[] {
  return [definitionType, ...keptAlongWith(keptAlong, definitionType).map((along) => along.definitionType)];
}
