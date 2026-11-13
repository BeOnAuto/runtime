import type { ContentHeads } from '@on.auto/content';
import { memoryContentHeads } from '@on.auto/content/testing';

import type { DefinitionNames } from '../definition-names/name-judgement.ts';
import type { ContentHolders, KeptProjection, RunOutcomeMapping, StreamProjection } from '../index.ts';
import { memoryProjections, type LoggedFact, type MemoryProjections } from '../projections/memory-projections.ts';
import { memoryRunOutcomes, type MemoryRunOutcomes } from '../run-outcomes/memory-run-outcomes.ts';
import { memoryNames, type MemoryNames } from './memory-names.ts';
import { memoryReferences, type MemoryReferences } from './memory-references.ts';

export interface MemoryTables {
  readonly runOutcomes: RunOutcomeMapping | undefined;
  readonly projections: readonly (KeptProjection | StreamProjection)[];
  readonly holders: ContentHolders | undefined;
  readonly definitionNames: DefinitionNames | undefined;
}

export interface KeptTables {
  readonly outcomes: MemoryRunOutcomes;
  readonly projected: MemoryProjections;
  readonly references: MemoryReferences;
  readonly holders: ContentHolders;
  readonly heads: ContentHeads;
  readonly names: MemoryNames;
}

export function keptTablesOf(
  { runOutcomes, projections, holders, definitionNames }: MemoryTables,
  loggedFacts: () => readonly LoggedFact[],
): KeptTables {
  const references = memoryReferences(holders);
  return {
    outcomes: memoryRunOutcomes(runOutcomes),
    projected: memoryProjections(projections, loggedFacts),
    references,
    holders: holders ?? new Map(),
    heads: memoryContentHeads(references.heldIn),
    names: memoryNames(definitionNames),
  };
}
