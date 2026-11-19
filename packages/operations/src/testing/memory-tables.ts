import type { ContentHeads } from '@on.auto/content';
import { memoryContentHeads } from '@on.auto/content/testing';

import type { DefinitionNames } from '../definition-names/name-judgement.ts';
import type { ContentHolders, KeptProjection, RunOutcomeMapping } from '../index.ts';
import { memoryProjections, type MemoryProjections } from '../projections/memory-projections.ts';
import type { RunIds } from '../run-ids/run-ids.ts';
import { memoryRunOutcomes, type MemoryRunOutcomes } from '../run-outcomes/memory-run-outcomes.ts';
import { memoryNames, type MemoryNames } from './memory-names.ts';
import { memoryReferences, type MemoryReferences } from './memory-references.ts';
import { memoryRunIds, type MemoryRunIds } from './memory-run-ids.ts';

export interface MemoryTables {
  readonly runOutcomes: RunOutcomeMapping | undefined;
  readonly projections: readonly KeptProjection[];
  readonly holders: ContentHolders | undefined;
  readonly definitionNames: DefinitionNames | undefined;
  readonly runIds: RunIds | undefined;
}

export interface KeptTables {
  readonly outcomes: MemoryRunOutcomes;
  readonly projected: MemoryProjections;
  readonly references: MemoryReferences;
  readonly holders: ContentHolders;
  readonly heads: ContentHeads;
  readonly names: MemoryNames;
  readonly runIds: MemoryRunIds;
}

export function keptTablesOf({ runOutcomes, projections, holders, definitionNames, runIds }: MemoryTables): KeptTables {
  const references = memoryReferences(holders);
  const names = memoryNames(definitionNames);
  return {
    outcomes: memoryRunOutcomes(runOutcomes, (playbookKey) =>
      names.held().filter((held) => held.playbookKey === playbookKey),
    ),
    projected: memoryProjections(projections, names.definitionsIn, (key) => names.heldBy(key)?.playbookKey),
    references,
    holders: holders ?? new Map(),
    heads: memoryContentHeads(references.heldIn),
    names,
    runIds: memoryRunIds(runIds),
  };
}
