import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExtensionPoint } from '@on.auto/definitions';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { configured, manifestSource, scratchFolder, scratchPackages } from '../testing/extensions/scratch-packages.ts';
import { listedExtensions, loadedExtensions, packageDirectoryOf, type LoadedExtensions } from './extension-loading.ts';
import { integrityOf } from './package-integrity.ts';

const GreeterSchema = Schema.Struct({
  name: Schema.String,
  greetings: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  place: Schema.Literals(['apart', 'within']),
});

type Greeter = typeof GreeterSchema.Type;

const decodeGreeter = Schema.decodeUnknownResult(GreeterSchema);

const greeterPoint: ExtensionPoint<Greeter> = {
  name: 'example/greeter',
  contracts: { least: 1, most: 3 },
  implementationOf: (value) =>
    Result.mapError(decodeGreeter(value), ({ message }: { readonly message: string }) => message),
  reservedForTheRelease: ({ name, place }) =>
    place === 'within'
      ? `it places the greeter ${name} within the server's own process, which only the release's own extensions may`
      : undefined,
};

const points = [greeterPoint];

function greeterSource(greeter: string, greetings: readonly string[], place = 'apart'): string {
  return `{ name: '${greeter}', greetings: ${JSON.stringify(greetings)}, place: '${place}' }`;
}

function provisionSource(implementation: string, contract = 1, point = 'example/greeter'): string {
  return `{ point: '${point}', contract: ${contract}, implementation: ${implementation} }`;
}

function greetingsProvidedBy(loaded: LoadedExtensions): readonly (readonly [string, readonly string[]])[] {
  return loaded.provided(greeterPoint).map(({ package: name, implementation }) => [name, implementation.greetings]);
}

describe('the extensions a runtime loads', () => {
  it('import each listed package, read the manifest it exports, and provide each point its implementations in the order listed', async () => {
    const { packages } = scratchPackages([
      {
        name: '@acme/greeters',
        module: manifestSource('@acme/greeters', [provisionSource(greeterSource('acme', ['hello', 'hi']))]),
      },
      {
        name: 'other-greeters',
        module: manifestSource('other-greeters', [provisionSource(greeterSource('other', ['hey']))]),
      },
    ]);

    const loaded = await loadedExtensions(configured('@acme/greeters', 'other-greeters'), points, packages);

    expect(loaded.extensions).toEqual([
      {
        package: '@acme/greeters',
        provenance: 'configured',
        name: '@acme/greeters',
        version: '1.0.0',
        provides: [{ point: 'example/greeter', contract: 1 }],
      },
      {
        package: 'other-greeters',
        provenance: 'configured',
        name: 'other-greeters',
        version: '1.0.0',
        provides: [{ point: 'example/greeter', contract: 1 }],
      },
    ]);
    expect(greetingsProvidedBy(loaded)).toEqual([
      ['@acme/greeters', ['hello', 'hi']],
      ['other-greeters', ['hey']],
    ]);
  });

  it('list the packages the settings name first, then those of the release that the settings do not name', () => {
    expect(
      listedExtensions(
        [{ package: '@acme/greeters' }, { package: '@on.auto/greeters', integrity: 'sha512-x' }],
        [{ package: '@on.auto/greeters' }, { package: '@on.auto/other' }],
      ),
    ).toEqual([
      { package: '@acme/greeters', provenance: 'configured', ofTheRelease: false },
      { package: '@on.auto/greeters', integrity: 'sha512-x', provenance: 'configured', ofTheRelease: true },
      { package: '@on.auto/other', provenance: 'release', ofTheRelease: true },
    ]);
  });
});

describe('an extension a runtime refuses, so that it does not start', () => {
  it.each<readonly [string, string, string]>([
    [
      'built against a contract outside the range the runtime accepts',
      manifestSource('@acme/greeters', [provisionSource(greeterSource('acme', ['hello']), 4)]),
      'The extension @acme/greeters is refused: it provides example/greeter built against contract 4, and this runtime accepts contracts 1 to 3',
    ],
    [
      'that exports no manifest',
      'export const greeter = {};\n',
      'The extension @acme/greeters is refused: it exports no manifest; an extension exports its manifest as manifest',
    ],
    [
      'that provides a point this release does not serve',
      manifestSource('@acme/greeters', [provisionSource(greeterSource('acme', ['hello']), 1, 'reasoning/gateway')]),
      'The extension @acme/greeters is refused: it provides reasoning/gateway, a point this release does not serve; it serves example/greeter',
    ],
    [
      'whose manifest is malformed',
      "export const manifest = { name: '@acme/greeters' };\n",
      'The extension @acme/greeters is refused: its manifest is malformed: Missing key',
    ],
    [
      'whose manifest names another package',
      manifestSource('@acme/other-greeters', [provisionSource(greeterSource('acme', ['hello']))]),
      "The extension @acme/greeters is refused: its manifest names the package @acme/other-greeters, and an extension's manifest names its own package",
    ],
    [
      'whose implementation is not one of its point',
      manifestSource('@acme/greeters', [provisionSource(greeterSource('acme', []))]),
      'The extension @acme/greeters is refused: its implementation of example/greeter is malformed: Expected a value with a length of at least 1',
    ],
    [
      'that provides one point twice',
      manifestSource('@acme/greeters', [
        provisionSource(greeterSource('acme', ['hello'])),
        provisionSource(greeterSource('acme', ['hi'])),
      ]),
      'The extension @acme/greeters is refused: it provides example/greeter twice, and an extension provides each point once',
    ],
  ])('names the package and why, for one %s', async (_case, module, refusal) => {
    const { packages } = scratchPackages([{ name: '@acme/greeters', module }]);

    await expect(loadedExtensions(configured('@acme/greeters'), points, packages)).rejects.toThrow(refusal);
  });
});

describe('an extension a runtime that serves no point refuses', () => {
  it('names no point it serves where it serves none', async () => {
    const { packages } = scratchPackages([
      {
        name: '@acme/greeters',
        module: manifestSource('@acme/greeters', [provisionSource(greeterSource('acme', ['hello']))]),
      },
    ]);

    await expect(loadedExtensions(configured('@acme/greeters'), [], packages)).rejects.toThrow(
      /^The extension @acme\/greeters is refused: it provides example\/greeter, a point this release does not serve$/u,
    );
  });
});

describe('an implementation a point reserves for the extensions of the release', () => {
  const withinManifest = manifestSource('@acme/greeters', [
    provisionSource(greeterSource('acme', ['hello'], 'within'), 2),
  ]);

  it('is refused in a listed extension, by name, with the words of its point', async () => {
    const { packages } = scratchPackages([{ name: '@acme/greeters', module: withinManifest }]);

    await expect(loadedExtensions(configured('@acme/greeters'), points, packages)).rejects.toThrow(
      "The extension @acme/greeters is refused: it places the greeter acme within the server's own process, which only the release's own extensions may",
    );
  });

  it('loads in an extension the release provides itself, listed by the settings or not', async () => {
    const { packages } = scratchPackages([{ name: '@acme/greeters', module: withinManifest }]);
    const ofTheRelease = { package: '@acme/greeters', ofTheRelease: true };

    const loaded = await Promise.all([
      loadedExtensions([{ ...ofTheRelease, provenance: 'release' }], points, packages),
      loadedExtensions([{ ...ofTheRelease, provenance: 'configured' }], points, packages),
    ]);

    expect(
      loaded.map(({ provided }) => provided(greeterPoint).map(({ implementation }) => implementation.place)),
    ).toEqual([['within'], ['within']]);
  });
});

describe('an extension a runtime refuses before it reads its manifest', () => {
  it('names a package that could not be imported', async () => {
    const { packages } = scratchPackages([]);

    await expect(loadedExtensions(configured('@acme/missing'), points, packages)).rejects.toThrow(
      "The extension @acme/missing is refused: it could not be imported: Cannot find package '@acme/missing'",
    );
  });
});

describe('the integrity of an extension', () => {
  it('lets the package load when its installed files are what the setting names, and refuses them otherwise, naming both', async () => {
    const module = manifestSource('@acme/greeters', [provisionSource(greeterSource('acme', ['hello']))]);
    const { packages, folderOf } = scratchPackages([{ name: '@acme/greeters', module }]);
    const integrity = await integrityOf(folderOf('@acme/greeters'));
    const other = `sha512-${'B'.repeat(86)}==`;

    const loaded = await loadedExtensions(
      [{ package: '@acme/greeters', integrity, provenance: 'configured', ofTheRelease: false }],
      points,
      packages,
    );

    expect(loaded.extensions.map(({ name }) => name)).toEqual(['@acme/greeters']);
    await expect(
      loadedExtensions(
        [{ package: '@acme/greeters', integrity: other, provenance: 'configured', ofTheRelease: false }],
        points,
        packages,
      ),
    ).rejects.toThrow(
      `The extension @acme/greeters is refused: its installed files have the integrity ${integrity}, and the setting names ${other}; install the package the setting names, or name the integrity of the one installed`,
    );
  });

  it('refuses a package whose folder cannot be found or read', async () => {
    const { packages } = scratchPackages([]);

    await expect(
      loadedExtensions(
        [{ package: '@acme/missing', integrity: 'sha512-x', provenance: 'configured', ofTheRelease: false }],
        points,
        packages,
      ),
    ).rejects.toThrow("The extension @acme/missing is refused: Cannot find package '@acme/missing'");
  });
});

describe('the folder of an installed package', () => {
  it('is the nearest folder above its entry whose package.json names it, and none when no folder does', () => {
    const root = scratchFolder();
    const entry = join(root, 'greeters', 'dist');
    mkdirSync(entry, { recursive: true });
    writeFileSync(join(root, 'greeters', 'package.json'), JSON.stringify({ name: '@acme/greeters' }));
    writeFileSync(join(root, 'package.json'), 'not json');

    expect(packageDirectoryOf('@acme/greeters', entry)).toBe(join(root, 'greeters'));
    expect(() => packageDirectoryOf('@acme/elsewhere', entry)).toThrow(
      'No folder above the entry of @acme/elsewhere holds its package.json',
    );
  });
});
