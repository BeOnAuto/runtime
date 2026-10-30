import { aliasPatternOf, matchesPattern, patternsOverlap, type AliasPattern } from './model-alias.ts';

export interface ModelOffer {
  readonly offers: (reference: string) => boolean;
  readonly offersCall: (requested: string, resolved: string) => boolean;
  readonly reaches: (reference: string) => boolean;
}

function covers(entry: AliasPattern, reference: AliasPattern): boolean {
  return reference.wildcard
    ? entry.wildcard && reference.prefix.startsWith(entry.prefix)
    : matchesPattern(entry, reference.prefix);
}

const everything: ModelOffer = {
  offers: () => true,
  offersCall: () => true,
  reaches: () => true,
};

export function modelOffer(allowed: readonly string[] | null): ModelOffer {
  if (allowed === null) {
    return everything;
  }
  const entries = allowed.map((reference) => aliasPatternOf(reference));
  const offers = (reference: string): boolean => entries.some((entry) => covers(entry, aliasPatternOf(reference)));
  return {
    offers,
    offersCall: (requested, resolved) => offers(requested) || offers(resolved),
    reaches: (reference) => entries.some((entry) => patternsOverlap(entry, aliasPatternOf(reference))),
  };
}
