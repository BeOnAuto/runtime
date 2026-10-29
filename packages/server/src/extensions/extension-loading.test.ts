import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { modelRuntimePoint } from '@on.auto/prediction';
import { describe, expect, it, onTestFinished } from 'vitest';

import {
  listedExtensions,
  loadedExtensions,
  packageDirectoryOf,
  type InstalledPackages,
  type ListedExtension,
} from './extension-loading.ts';
import { integrityOf } from './package-integrity.ts';

interface Fixture {
  readonly name: string;
  readonly module: string;
}

function scratch(): string {
  const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-extension-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

function runtimeSource(runtime: string, formats: readonly string[]): string {
  return `{ name: '${runtime}', version: '2.0.0', formats: ${JSON.stringify(formats)}, capabilities: { features: true, given: true, totals: true }, binding: { kind: 'process', module: () => new URL('./models.mjs', import.meta.url) } }`;
}

function provisionSource(
  runtime: string,
  formats: readonly string[],
  contract = 1,
  point = 'prediction/model-runtime',
): string {
  return `{ point: '${point}', contract: ${contract}, implementation: ${runtimeSource(runtime, formats)} }`;
}

function manifestSource(name: string, provisions: readonly string[]): string {
  return `export const manifest = { name: '${name}', version: '1.0.0', provides: [${provisions.join(', ')}] };\n`;
}

function installed(fixtures: readonly Fixture[]): {
  readonly packages: InstalledPackages;
  readonly folderOf: (name: string) => string;
} {
  const root = scratch();
  const folders = new Map(
    fixtures.map(({ name, module }, at) => {
      const folder = join(root, `package-${at}`);
      mkdirSync(folder);
      writeFileSync(join(folder, 'package.json'), JSON.stringify({ name, type: 'module' }));
      writeFileSync(join(folder, 'index.mjs'), module);
      return [name, folder];
    }),
  );
  const folderOf = (name: string): string => {
    const folder = folders.get(name);
    if (folder === undefined) {
      throw new Error(`Cannot find package '${name}'`);
    }
    return folder;
  };
  return {
    folderOf,
    packages: {
      imported: (name) => import(pathToFileURL(join(folderOf(name), 'index.mjs')).href),
      directoryOf: folderOf,
    },
  };
}

function configured(...packages: readonly string[]): readonly ListedExtension[] {
  return packages.map((name) => ({ package: name, provenance: 'configured', ofTheRelease: false }));
}

const points = [modelRuntimePoint];

describe('the extensions a runtime loads', () => {
  it('import each listed package, read the manifest it exports, and provide each point its implementations in the order listed', async () => {
    const { packages } = installed([
      {
        name: '@acme/models',
        module: manifestSource('@acme/models', [provisionSource('acme-runtime', ['acme', 'graph'])]),
      },
      { name: 'other-models', module: manifestSource('other-models', [provisionSource('other-runtime', ['graph'])]) },
    ]);

    const loaded = await loadedExtensions(configured('@acme/models', 'other-models'), points, packages);

    expect(loaded.extensions).toEqual([
      {
        package: '@acme/models',
        provenance: 'configured',
        name: '@acme/models',
        version: '1.0.0',
        provides: [{ point: 'prediction/model-runtime', contract: 1 }],
      },
      {
        package: 'other-models',
        provenance: 'configured',
        name: 'other-models',
        version: '1.0.0',
        provides: [{ point: 'prediction/model-runtime', contract: 1 }],
      },
    ]);
    expect(loaded.provided(modelRuntimePoint).map(({ name, formats }) => [name, formats])).toEqual([
      ['acme-runtime', ['acme', 'graph']],
      ['other-runtime', ['graph']],
    ]);
  });

  it('list the packages the settings name first, then those of the release that the settings do not name', () => {
    expect(
      listedExtensions(
        [{ package: '@acme/models' }, { package: '@on.auto/prediction-series', integrity: 'sha512-x' }],
        [{ package: '@on.auto/prediction-series' }, { package: '@on.auto/other' }],
      ),
    ).toEqual([
      { package: '@acme/models', provenance: 'configured', ofTheRelease: false },
      { package: '@on.auto/prediction-series', integrity: 'sha512-x', provenance: 'configured', ofTheRelease: true },
      { package: '@on.auto/other', provenance: 'release', ofTheRelease: true },
    ]);
  });
});

describe('an extension a runtime refuses, so that it does not start', () => {
  it.each<readonly [string, string, string]>([
    [
      'built against a contract outside the range the runtime accepts',
      manifestSource('@acme/models', [provisionSource('acme-runtime', ['acme'], 3)]),
      'The extension @acme/models is refused: it provides prediction/model-runtime built against contract 3, and this runtime accepts contracts 1 to 2',
    ],
    [
      'that exports no manifest',
      'export const runtime = {};\n',
      'The extension @acme/models is refused: it exports no manifest; an extension exports its manifest as manifest',
    ],
    [
      'that provides a point no capability declares',
      manifestSource('@acme/models', [provisionSource('acme-runtime', ['acme'], 1, 'reasoning/gateway')]),
      'The extension @acme/models is refused: it provides reasoning/gateway, which no capability of this runtime declares; the points declared are prediction/model-runtime',
    ],
    [
      'whose manifest is malformed',
      "export const manifest = { name: '@acme/models' };\n",
      'The extension @acme/models is refused: its manifest is malformed: Missing key',
    ],
    [
      'whose manifest names another package',
      manifestSource('@acme/other-models', [provisionSource('acme-runtime', ['acme'])]),
      "The extension @acme/models is refused: its manifest names the package @acme/other-models, and an extension's manifest names its own package",
    ],
    [
      'whose binding cannot name its module',
      manifestSource('@acme/models', [
        "{ point: 'prediction/model-runtime', contract: 1, implementation: { name: 'acme-runtime', version: '2.0.0', formats: ['acme'], capabilities: { features: true, given: true, totals: true }, binding: { kind: 'process', module: () => { throw new Error('no module here'); } } } }",
      ]),
      'The extension @acme/models is refused: its implementation of prediction/model-runtime is refused: Its binding could not name its module: no module here',
    ],
    [
      'whose implementation is not one of its point',
      manifestSource('@acme/models', [provisionSource('acme-runtime', [])]),
      'The extension @acme/models is refused: its implementation of prediction/model-runtime is refused: Expected a value with a length of at least 1',
    ],
  ])('names the package and why, for one %s', async (_case, module, refusal) => {
    const { packages } = installed([{ name: '@acme/models', module }]);

    await expect(loadedExtensions(configured('@acme/models'), points, packages)).rejects.toThrow(refusal);
  });
});

describe("a model runtime bound inline, into the server's own process", () => {
  const inlineManifest = manifestSource('@acme/models', [
    provisionSource('acme-runtime', ['acme'], 2).replace("kind: 'process'", "kind: 'inline'"),
  ]);

  it("refuses a listed extension that provides one, by name, since an extension's runtime runs in a model process", async () => {
    const { packages } = installed([{ name: '@acme/models', module: inlineManifest }]);

    await expect(loadedExtensions(configured('@acme/models'), points, packages)).rejects.toThrow(
      "The extension @acme/models is refused: it binds the model runtime acme-runtime inline, into the server's own process, which only the release's own extensions may: an extension's runtime runs in a model process, so its binding is a process",
    );
  });

  it('loads one the release provides itself, listed by the settings or not', async () => {
    const { packages } = installed([{ name: '@acme/models', module: inlineManifest }]);
    const ofTheRelease = { package: '@acme/models', ofTheRelease: true };

    const loaded = await Promise.all([
      loadedExtensions([{ ...ofTheRelease, provenance: 'release' }], points, packages),
      loadedExtensions([{ ...ofTheRelease, provenance: 'configured' }], points, packages),
    ]);

    expect(loaded.map(({ provided }) => provided(modelRuntimePoint).map(({ binding }) => binding.kind))).toEqual([
      ['inline'],
      ['inline'],
    ]);
  });
});

describe('an extension a runtime refuses before it reads its manifest', () => {
  it('names a package that could not be imported', async () => {
    const { packages } = installed([]);

    await expect(loadedExtensions(configured('@acme/missing'), points, packages)).rejects.toThrow(
      "The extension @acme/missing is refused: it could not be imported: Cannot find package '@acme/missing'",
    );
  });
});

describe('the integrity of an extension', () => {
  it('lets the package load when its installed files are what the setting names, and refuses them otherwise, naming both', async () => {
    const module = manifestSource('@acme/models', [provisionSource('acme-runtime', ['acme'])]);
    const { packages, folderOf } = installed([{ name: '@acme/models', module }]);
    const integrity = await integrityOf(folderOf('@acme/models'));
    const other = `sha512-${'B'.repeat(86)}==`;

    const loaded = await loadedExtensions(
      [{ package: '@acme/models', integrity, provenance: 'configured', ofTheRelease: false }],
      points,
      packages,
    );

    expect(loaded.extensions.map(({ name }) => name)).toEqual(['@acme/models']);
    await expect(
      loadedExtensions(
        [{ package: '@acme/models', integrity: other, provenance: 'configured', ofTheRelease: false }],
        points,
        packages,
      ),
    ).rejects.toThrow(
      `The extension @acme/models is refused: its installed files have the integrity ${integrity}, and the setting names ${other}; install the package the setting names, or name the integrity of the one installed`,
    );
  });

  it('refuses a package whose folder cannot be found or read', async () => {
    const { packages } = installed([]);

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
    const root = scratch();
    const entry = join(root, 'models', 'dist');
    mkdirSync(entry, { recursive: true });
    writeFileSync(join(root, 'models', 'package.json'), JSON.stringify({ name: '@acme/models' }));
    writeFileSync(join(root, 'package.json'), 'not json');

    expect(packageDirectoryOf('@acme/models', entry)).toBe(join(root, 'models'));
    expect(() => packageDirectoryOf('@acme/elsewhere', entry)).toThrow(
      'No folder above the entry of @acme/elsewhere holds its package.json',
    );
  });
});
