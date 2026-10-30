import { Option } from 'effect';

import { parseModelReference } from './model-reference.ts';

export interface AliasPattern {
  readonly prefix: string;
  readonly wildcard: boolean;
}

const wildcard = '*';

export function aliasPatternOf(reference: string): AliasPattern {
  return reference.endsWith(wildcard)
    ? { prefix: reference.slice(0, -wildcard.length), wildcard: true }
    : { prefix: reference, wildcard: false };
}

export function isWildcardAlias(reference: string): boolean {
  return aliasPatternOf(reference).wildcard;
}

export function namesModels(reference: string): boolean {
  const { prefix, wildcard: anyModel } = aliasPatternOf(reference);
  return Option.isSome(parseModelReference(anyModel ? `${prefix}model` : prefix));
}

function wildcardIsTrailing(reference: string): boolean {
  return !aliasPatternOf(reference).prefix.includes(wildcard);
}

export function wildcardsAreTrailing(alias: string, target: string): boolean {
  return wildcardIsTrailing(alias) && wildcardIsTrailing(target) && isWildcardAlias(alias) === isWildcardAlias(target);
}

export function matchesPattern(pattern: AliasPattern, reference: string): boolean {
  return pattern.wildcard
    ? reference.length > pattern.prefix.length && reference.startsWith(pattern.prefix)
    : reference === pattern.prefix;
}

export function patternsOverlap(target: AliasPattern, alias: AliasPattern): boolean {
  if (!target.wildcard) {
    return matchesPattern(alias, target.prefix);
  }
  return alias.wildcard
    ? alias.prefix.startsWith(target.prefix) || target.prefix.startsWith(alias.prefix)
    : matchesPattern(target, alias.prefix);
}

interface WildcardAlias {
  readonly alias: AliasPattern;
  readonly target: AliasPattern;
}

function wildcardAliasesOf(aliases: ReadonlyMap<string, string>): readonly WildcardAlias[] {
  return [...aliases]
    .map(([alias, target]: readonly [string, string]): WildcardAlias => ({
      alias: aliasPatternOf(alias),
      target: aliasPatternOf(target),
    }))
    .filter(({ alias }) => alias.wildcard)
    .toSorted((longer, shorter) => shorter.alias.prefix.length - longer.alias.prefix.length);
}

export function aliasResolution(aliases: ReadonlyMap<string, string>): (requested: string) => string {
  const wildcardAliases = wildcardAliasesOf(aliases);
  return (requested) => {
    const exact = aliases.get(requested);
    const wildcardMatch = wildcardAliases.find(({ alias }) => matchesPattern(alias, requested));
    if (exact !== undefined || wildcardMatch === undefined) {
      return exact ?? requested;
    }
    return `${wildcardMatch.target.prefix}${requested.slice(wildcardMatch.alias.prefix.length)}`;
  };
}
