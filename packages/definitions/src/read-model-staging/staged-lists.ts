import type { PlaybookContext, PlaybookReader } from '@on.auto/operations';
import { Array as Arr, Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { byName, listedDefinitionOf } from '../operations/answered-definitions.ts';
import { loadRegistry } from '../operations/registry-access.ts';
import { listedRowsFromTheReadModel, type ListedRow } from '../read-model-reads/read-model-lists.ts';
import { isRetired, type ListedDefinition } from '../registry/definition.ts';
import { differingFieldsOf, sameAnswer } from './same-answers.ts';
import { stagedRead, type ComparedOutcome, type Comparison } from './shadow-comparison.ts';

type Reading<A> = Effect.Effect<A, never, PlaybookReader | PlaybookContext>;

export interface ListedToday {
  readonly listed: ListedDefinition;
  readonly saved: readonly string[];
}

interface EntryCompared {
  readonly outcome: ComparedOutcome;
  readonly differing: readonly string[];
  readonly row: ListedRow['row'];
  readonly warnings: number;
  readonly savedWarnings: number;
}

export const ignoredMessage = 'A list entry of the read model answered the warnings its save recorded';

function listedToday(capability: Capability, includeRetired: boolean): Reading<readonly ListedToday[]> {
  return Effect.flatMap(loadRegistry(capability.type), (registry) => {
    const definitions = [...registry.values()].filter((definition) => includeRetired || !isRetired(definition));
    return Effect.forEach(definitions.toSorted(byName), (definition) =>
      Effect.map(listedDefinitionOf(capability, definition), (listed): ListedToday => ({
        listed,
        saved: definition.warnings ?? [],
      })),
    );
  });
}

function outcomeOfAnEntry(differing: readonly string[], asSaved: boolean): ComparedOutcome {
  if (differing.length === 0) {
    return 'matched';
  }
  return sameAnswer(differing, ['warnings']) && asSaved ? 'ignored' : 'mismatched';
}

function entryCompared({ listed: entry, saved }: ListedToday, { row, listed }: ListedRow): EntryCompared {
  const differing = differingFieldsOf(entry, listed);
  const asSaved = sameAnswer(listed.warnings ?? [], saved);
  const counted = { row, warnings: (entry.warnings ?? []).length, savedWarnings: saved.length };
  return { outcome: outcomeOfAnEntry(differing, asSaved), differing, ...counted };
}

function ignoredLogged(type: string, { row, warnings, savedWarnings }: EntryCompared): Effect.Effect<void> {
  return Effect.logInfo(ignoredMessage).pipe(
    Effect.annotateLogs({
      definition_type: type,
      saved_position: row.saved_position,
      warnings_today: warnings,
      warnings_saved: savedWarnings,
    }),
  );
}

function outcomeOf(entries: readonly EntryCompared[]): ComparedOutcome {
  if (entries.some(({ outcome }) => outcome === 'mismatched')) {
    return 'mismatched';
  }
  return entries.some(({ outcome }) => outcome === 'ignored') ? 'ignored' : 'matched';
}

export function listsCompared(
  type: string,
  today: readonly ListedToday[],
  candidate: readonly ListedRow[],
): Effect.Effect<Comparison> {
  const counts = { entries: today.length, read_model_entries: candidate.length };
  if (today.length !== candidate.length) {
    return Effect.succeed({ outcome: 'mismatched', differing: ['entries'], counts });
  }
  const entries = Arr.zip(today, candidate).map(([entry, listed]: readonly [ListedToday, ListedRow]) =>
    entryCompared(entry, listed),
  );
  const ignored = entries.filter(({ outcome }) => outcome === 'ignored');
  const mismatched = entries.filter(({ outcome }) => outcome === 'mismatched');
  return Effect.as(
    Effect.forEach(ignored, (entry) => ignoredLogged(type, entry), { discard: true }),
    {
      outcome: outcomeOf(entries),
      differing: [...new Set(mismatched.flatMap(({ differing }) => differing))].toSorted(),
      counts: { ...counts, mismatched_entries: mismatched.length, ignored_entries: ignored.length },
    },
  );
}

export function stagedList(capability: Capability, includeRetired: boolean): Reading<readonly ListedToday[]> {
  return stagedRead({
    read: 'list_definitions',
    reading: 'answers',
    definitionType: capability.type,
    involved: [capability.type],
    today: listedToday(capability, includeRetired),
    fromTheReadModel: listedRowsFromTheReadModel(capability, includeRetired),
    answerOf: (candidate) => candidate.map(({ listed }): ListedToday => ({ listed, saved: [] })),
    compared: (today, candidate) => listsCompared(capability.type, today, candidate),
  });
}
