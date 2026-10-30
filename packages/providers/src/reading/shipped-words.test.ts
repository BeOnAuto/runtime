import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { readProviders, type ProviderEntry, providersShippedRoots } from '../index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const bareVerbs: ReadonlySet<string> = new Set([
  'Act',
  'Add',
  'Ask',
  'Change',
  'Create',
  'Delete',
  'Keep',
  'Manage',
  'Post',
  'Read',
  'Run',
  'Search',
  'See',
  'Send',
]);

const personalPronouns = /\b(?:I|me|my|mine|we|us|our|ours|you|your|yours|he|him|his|she|her|hers)\b/iu;

interface SaidScope {
  readonly provider: string;
  readonly scope: string;
  readonly says: string | undefined;
}

interface Said {
  readonly scope?: string | undefined;
  readonly says?: Readonly<Record<string, string>> | undefined;
}

function scopesSaidBy(provider: string, { scope, says = {} }: Said): readonly SaidScope[] {
  return (scope === undefined ? [] : scope.split(' ')).map((each) => ({ provider, scope: each, says: says[each] }));
}

function saidScopesOf({ name, credentials }: ProviderEntry): readonly SaidScope[] {
  return credentials.flatMap((way) => [
    ...scopesSaidBy(name, way),
    ...(way.more ?? []).flatMap((group) => scopesSaidBy(name, group)),
  ]);
}

function opensWithABareVerb(sentence: string): boolean {
  const [verb = ''] = sentence.split(/[ ,]/u);
  return sentence.length <= 120 && bareVerbs.has(verb) && sentence.endsWith('.');
}

function breaksTheRule({ says = '' }: SaidScope): boolean {
  return !opensWithABareVerb(says) || personalPronouns.test(says);
}

const saidScopes = shipped.providers.flatMap(({ entry }) => saidScopesOf(entry));

const groupsSaid = shipped.providers.flatMap(({ entry }) => entry.credentials.flatMap(({ more = [] }) => more));

describe('the words of the scopes the shipped providers ask', () => {
  it('say every scope in at most 120 characters, opening with a bare verb and naming no person by a pronoun', () => {
    expect(saidScopes.filter((said) => breaksTheRule(said))).toEqual([]);
    expect(saidScopes).toHaveLength(122);
  });

  it('say what each group a later consent may add is for in the words of the person, opening with a bare verb', () => {
    expect(groupsSaid.filter((group) => !opensWithABareVerb(group.for))).toEqual([]);
    expect(groupsSaid).toHaveLength(1);
  });
});
