import { decodedJsonSettingWith, strictly } from '@on.auto/config';
import { JsonPointer, Result, Schema } from 'effect';

import { aliasPatternOf, namesModels, patternsOverlap, wildcardsAreTrailing } from '../model/model-alias.ts';
import { problemAt, type SettingProblem } from './setting-values.ts';

export interface AliasReading {
  readonly problems: readonly SettingProblem[];
  readonly aliases: ReadonlyMap<string, string>;
}

type Aliases = Readonly<Record<string, string>>;

const setting = 'MODEL_ALIASES';

export const ModelAliasesSchema = Schema.Record(Schema.String, Schema.String);

const decodeAliases = Schema.decodeUnknownResult(ModelAliasesSchema, strictly);

function referenceProblems(alias: string, target: string): readonly SettingProblem[] {
  if (!wildcardsAreTrailing(alias, target)) {
    return problemAt(
      setting,
      `/${JsonPointer.escapeToken(alias)}`,
      `A * stands once, at the end of both an alias and its target`,
    );
  }
  const malformed = [alias, target].some((reference) => !namesModels(reference));
  return malformed
    ? problemAt(
        setting,
        `/${JsonPointer.escapeToken(alias)}`,
        `An alias and its target are each written provider/model`,
      )
    : [];
}

function hopProblems(alias: string, target: string, aliases: Aliases): readonly SettingProblem[] {
  const resolvedAgain = Object.keys(aliases).some((other) =>
    patternsOverlap(aliasPatternOf(target), aliasPatternOf(other)),
  );
  return resolvedAgain
    ? problemAt(
        setting,
        `/${JsonPointer.escapeToken(alias)}`,
        `The target is itself an alias; an alias resolves in one hop`,
      )
    : [];
}

function entryProblems(alias: string, target: string, aliases: Aliases): readonly SettingProblem[] {
  const shapeProblems = referenceProblems(alias, target);
  return shapeProblems.length === 0 ? hopProblems(alias, target, aliases) : shapeProblems;
}

function readingOf(aliases: Aliases): AliasReading {
  const entries = Object.entries(aliases);
  return {
    problems: entries.flatMap(([alias, target]: readonly [string, string]) => entryProblems(alias, target, aliases)),
    aliases: new Map(entries),
  };
}

export function aliasReading(text: string | undefined): AliasReading {
  if (text === undefined) {
    return readingOf({});
  }
  return Result.match(decodedJsonSettingWith(setting, text, decodeAliases), {
    onSuccess: readingOf,
    onFailure: (problems) => ({ problems, aliases: new Map() }),
  });
}
