import { alternatives } from '@on.auto/phrasing';
import { Result } from 'effect';

import { referenceLimitsOf, type CatalogEntry, type Seconds } from './catalog-entry.ts';
import { knownAudioFormats } from './media-types.ts';

export interface GenerationCatalog {
  readonly entries: readonly CatalogEntry[];
  readonly entryOf: (model: string) => CatalogEntry | undefined;
}

export interface EntryProblem {
  readonly model: string;
  readonly detail: string;
}

function secondsProblems(seconds: Seconds | undefined): readonly string[] {
  return seconds === undefined || seconds.least <= seconds.most
    ? []
    : [`limits.seconds: the least, ${seconds.least}, is more than the most, ${seconds.most}`];
}

function formatProblems(entry: CatalogEntry): readonly string[] {
  const unknown =
    entry.kind === 'audio' ? entry.limits.formats.filter((format) => !knownAudioFormats.includes(format)) : [];
  return unknown.map(
    (format) =>
      `limits.formats: ${format} is no format the runtime keeps, which are ${alternatives(knownAudioFormats)}`,
  );
}

function referenceProblems(entry: CatalogEntry): readonly string[] {
  const takesReferences = referenceLimitsOf(entry) !== undefined;
  if (takesReferences && entry.media_types.length === 0) {
    return ['media_types: a model that takes references names the media types it takes'];
  }
  return !takesReferences && entry.media_types.length > 0
    ? ['media_types: a model that takes no references names no media types']
    : [];
}

function ownProblems(entry: CatalogEntry): readonly string[] {
  const seconds = entry.kind === 'image' ? undefined : entry.limits.seconds;
  return [...secondsProblems(seconds), ...formatProblems(entry), ...referenceProblems(entry)];
}

function replacementProblems(entry: CatalogEntry, byModel: ReadonlyMap<string, CatalogEntry>): readonly string[] {
  if (entry.retired === undefined) {
    return [];
  }
  const { replacement } = entry.retired;
  const named = byModel.get(replacement);
  if (named === undefined || named === entry) {
    return [`retired.replacement: ${replacement} is no other model of the catalogue`];
  }
  if (named.kind !== entry.kind) {
    return [`retired.replacement: ${replacement} produces ${named.kind}, not ${entry.kind}`];
  }
  return named.retired === undefined ? [] : [`retired.replacement: ${replacement} is retired too`];
}

function repeatedProblems(entries: readonly CatalogEntry[]): readonly EntryProblem[] {
  return entries
    .filter(({ model }, index) => entries.findIndex((other) => other.model === model) < index)
    .map(({ model }) => ({ model, detail: `${model} has more than one entry` }));
}

export function catalogOf(entries: readonly CatalogEntry[]): Result.Result<GenerationCatalog, readonly EntryProblem[]> {
  const byModel = new Map(entries.map((entry) => [entry.model, entry]));
  const problems = [
    ...repeatedProblems(entries),
    ...entries.flatMap((entry) =>
      [...ownProblems(entry), ...replacementProblems(entry, byModel)].map((detail) => ({ model: entry.model, detail })),
    ),
  ];
  return problems.length > 0
    ? Result.fail(problems)
    : Result.succeed({ entries, entryOf: (model) => byModel.get(model) });
}
