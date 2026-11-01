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
});
