import { describe, expect, it } from 'vitest';

import { aliasPlace, aliasedNamesOf, readmeWithAlias, subpathsOf, type PackedPackage } from './package-subpaths.ts';

const packed: readonly PackedPackage[] = [
  {
    name: '@on.auto/ledger',
    directory: 'packages/ledger',
    exports: { '.': './src/index.ts', './sqlite3': './src/sqlite3.ts', './testing': './src/testing/index.ts' },
  },
  { name: '@on.auto/recall', directory: 'capabilities/recall', exports: { '.': './src/index.ts' } },
  { name: '@on.auto/server', directory: 'packages/server', exports: {} },
];

describe('the subpaths of the package', () => {
  it('name each entry of each packed package under the name of the package within its scope', () => {
    expect(subpathsOf(packed)).toEqual({
      './ledger': './packages/ledger/src/index.ts',
      './ledger/sqlite3': './packages/ledger/src/sqlite3.ts',
      './ledger/testing': './packages/ledger/src/testing/index.ts',
      './recall': './capabilities/recall/src/index.ts',
    });
  });

  it('are aliased from the names of the packages that have entries', () => {
    expect(aliasedNamesOf(packed)).toEqual(['ledger', 'recall']);
  });
});

describe('the README of the package', () => {
  it('holds, where it names the place of the alias, the names and the alias from each to its subpath', () => {
    const readme = ['Alias them:', '', aliasPlace, '', '## License'].join('\n');

    expect(readmeWithAlias(readme, '@on.auto/runtime', ['ledger', 'recall'])).toBe(
      [
        'Alias them:',
        '',
        '```js',
        "const names = ['ledger', 'recall'];",
        'const alias = Object.fromEntries(names.map((name) => [`@on.auto/${name}`, `@on.auto/runtime/${name}`]));',
        '```',
        '',
        '## License',
      ].join('\n'),
    );
  });

  it('is refused when it names the place of the alias not once', () => {
    expect(() => readmeWithAlias('Alias them.', '@on.auto/runtime', ['ledger'])).toThrow(
      `The README must hold ${aliasPlace} once`,
    );
    expect(() => readmeWithAlias(`${aliasPlace}\n${aliasPlace}`, '@on.auto/runtime', ['ledger'])).toThrow(
      `The README must hold ${aliasPlace} once`,
    );
  });
});
