import { describe, expect, it } from 'vitest';

import { aliasesTakenIn, providerNamesOf } from '../index.ts';
import { decodedEntry, problemsOf } from '../testing/entry-problems.ts';
import { tracker } from '../testing/fixture-providers.ts';

function aliased(aliases: unknown) {
  return { ...tracker, aliases };
}

describe('the other names an entry is found by', () => {
  it('are names of providers, after its own, and left out where it has none', () => {
    expect(decodedEntry(aliased(['issues', 'tickets'])).aliases).toEqual(['issues', 'tickets']);
    expect(providerNamesOf(decodedEntry(aliased(['issues', 'tickets'])))).toEqual(['tracker', 'issues', 'tickets']);
    expect(decodedEntry(tracker).aliases).toBeUndefined();
    expect(providerNamesOf(tracker)).toEqual(['tracker']);
    expect(problemsOf(aliased(['issues']))).toEqual([]);
  });

  it('are at least one, each a provider’s name, never the entry’s own, each once', () => {
    expect(problemsOf(aliased([]))).toEqual([['/aliases', 'Expected a value with a length of at least 1']]);
    expect(problemsOf(aliased(['Issues', 'tracker', 'issues', 'issues']))).toEqual([
      ['/aliases/0', 'Expected a name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter'],
      ['/aliases/1', "Expected another name: the provider's own name finds it already"],
      ['/aliases/3', 'Expected each name once'],
    ]);
  });

  it('are never a name of a provider it replaces', () => {
    expect(problemsOf({ ...tracker, aliases: ['issues', 'tickets'], replaces: ['tickets'] })).toEqual([
      [
        '/aliases/1',
        'Expected a name the provider does not replace: a provider is not found by the name of one it replaces',
      ],
    ]);
  });
});

describe('the names of a list of entries', () => {
  it('find one entry each: an alias that is another entry’s name or alias is taken, at each entry that has it', () => {
    const entries = [
      { name: 'tracker', aliases: ['issues', 'notes'] },
      { name: 'notes' },
      { name: 'tickets', aliases: ['issues', 'tasks'] },
    ];

    expect(aliasesTakenIn(entries)).toEqual([
      {
        entry: 0,
        at: 0,
        detail: 'Expected a name no other provider is found by: the provider tickets is found by issues',
      },
      {
        entry: 0,
        at: 1,
        detail: 'Expected a name no other provider is found by: the provider notes is found by notes',
      },
      {
        entry: 2,
        at: 0,
        detail: 'Expected a name no other provider is found by: the provider tracker is found by issues',
      },
    ]);
    expect(aliasesTakenIn([{ name: 'tracker', aliases: ['issues'] }, { name: 'notes' }])).toEqual([]);
  });
});
