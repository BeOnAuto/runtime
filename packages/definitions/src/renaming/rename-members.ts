import type { Capability } from '../capability/capability.ts';
import { isPlaybookRunEventType } from '../events/playbook-facts.ts';
import type { RegisteredDefinition } from '../registry/definition-registry.ts';
import { isRetired } from '../registry/definition.ts';
import type { NamedDefinition } from '../used-by/called-definitions.ts';
import { namingDetailsOf, type PlaybookRegistries } from '../used-by/definition-users.ts';
import { definitionSubject, type DefinitionsNamed } from '../used-by/definitions-named.ts';

export interface Renaming {
  readonly type: string;
  readonly from: string;
  readonly to: string;
}

export interface RenameCandidate extends NamedDefinition {
  readonly capability: Capability;
  readonly stored: RegisteredDefinition;
  readonly namedAsStored: boolean;
  readonly callsOrReads: boolean;
}

export interface RenameMember extends RenameCandidate {
  readonly named: DefinitionsNamed;
  readonly usedByItsRuns: boolean;
}

interface FilterWritten {
  readonly type: unknown;
  readonly subject: unknown;
}

export function filtersOnItsRuns({ type, subject }: FilterWritten, { type: renamed, from }: Renaming): boolean {
  return typeof type === 'string' && isPlaybookRunEventType(type) && subject === definitionSubject(renamed, from);
}

function callsOrReadsIt(stored: RegisteredDefinition, { type, from }: Renaming): boolean {
  const { calls = [], reads = [] } = namingDetailsOf(stored.details);
  return [...calls, ...reads].some((named) => named.type === type && named.name === from);
}

export function pageFiltersOf({ page }: RegisteredDefinition): readonly FilterWritten[] {
  return (page?.details.data?.filters ?? []).map((filter) => ({ type: filter.type, subject: filter['subject'] }));
}

function triggerFiltersOf({ triggers = [] }: RegisteredDefinition): readonly FilterWritten[] {
  return triggers.flatMap((trigger) =>
    trigger.kind === 'event'
      ? trigger.filters.map(({ type, attributes }) => ({ type, subject: attributes['subject'] }))
      : [],
  );
}

function filtersOnIt(stored: RegisteredDefinition, renaming: Renaming): boolean {
  return [...triggerFiltersOf(stored), ...pageFiltersOf(stored)].some((filter) => filtersOnItsRuns(filter, renaming));
}

function candidatesOfType(
  capability: Capability,
  registry: ReadonlyMap<string, RegisteredDefinition>,
  renaming: Renaming,
): readonly RenameCandidate[] {
  const { type } = capability;
  return [...registry.values()].flatMap((stored): readonly RenameCandidate[] => {
    const callsOrReads = callsOrReadsIt(stored, renaming);
    const itself = type === renaming.type && stored.name === renaming.from;
    const namedAsStored = itself || callsOrReads || filtersOnIt(stored, renaming);
    return isRetired(stored) ? [] : [{ type, name: stored.name, capability, stored, namedAsStored, callsOrReads }];
  });
}

export function renameCandidatesIn(
  capabilities: readonly Capability[],
  registries: PlaybookRegistries,
  renaming: Renaming,
): readonly RenameCandidate[] {
  return capabilities.flatMap((capability) =>
    candidatesOfType(capability, registries.get(capability.type) ?? new Map(), renaming),
  );
}

interface DeclaredUses {
  readonly declares: boolean;
  readonly awaits: boolean;
}

export function declaredUsesOf({ names, subjects, awaited }: DefinitionsNamed, renaming: Renaming): DeclaredUses {
  const awaits = awaited.some((written) => filtersOnItsRuns(written, renaming));
  const named = names.some(({ type, name }) => type === renaming.type && name === renaming.from);
  return { declares: awaits || named || subjects.some((written) => filtersOnItsRuns(written, renaming)), awaits };
}
