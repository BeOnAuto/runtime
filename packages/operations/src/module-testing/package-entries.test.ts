import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { modulesReachedFrom } from './modules-reached.ts';

const source = join(import.meta.dirname, '..');

describe('the entries of the package', () => {
  it('keep the files of the main entry, which every package imports, from importing any module of Node, and any package but effect, the content model and phrasing', () => {
    const main = modulesReachedFrom(source, 'index.ts');

    expect(main.files).toContain('dispatch/dispatcher.ts');
    expect(main.packages).toEqual(['@on.auto/content', '@on.auto/phrasing', 'effect']);
  });

  it('keep the files of the payloads entry to the content model and effect, and away from the dispatcher', () => {
    const payloads = modulesReachedFrom(source, 'payloads/index.ts');

    expect(payloads.packages).toEqual(['@on.auto/content', 'effect']);
    expect(payloads.files.filter((file) => file.startsWith('dispatch/'))).toEqual([]);
  });

  it('keep the judgement of the names of definitions to its own file and what it names of a conflict and a fact, reaching no package', () => {
    const names = modulesReachedFrom(source, 'definition-names/name-judgement.ts');

    expect(names.packages).toEqual([]);
    expect(names.files.filter((file) => file.startsWith('dispatch/'))).toEqual([]);
  });
});
