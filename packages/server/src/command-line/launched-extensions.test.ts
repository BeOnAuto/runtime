import { existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { dailyVisits } from '../prediction/published-visits.ts';
import {
  launching,
  npmInstalledIn,
  runtimeInstalledIn,
  scratchFolder,
  type InstalledPackage,
  type LaunchedRuntime,
} from '../testing/processes/installed-runtime.ts';
import { installedRelease, launch, movedIntoPlace } from './launch.ts';

const words: InstalledPackage = {
  name: '@acme/forecast-words',
  files: {
    'package.json': JSON.stringify({
      name: '@acme/forecast-words',
      version: '1.0.0',
      type: 'module',
      exports: './index.js',
    }),
    'index.js': "export const answeredBy = '@acme/forecasts, in its own words';\n",
  },
};

const forecasts: InstalledPackage = {
  name: '@acme/forecasts',
  files: {
    'package.json': JSON.stringify({
      name: '@acme/forecasts',
      version: '1.0.0',
      type: 'module',
      exports: './index.js',
      dependencies: { '@acme/forecast-words': '1.0.0' },
      peerDependencies: { '@on.auto/runtime': '*', effect: '*' },
    }),
    'index.js': [
      "import { answeredBy } from '@acme/forecast-words';",
      "import { defineCapability } from '@on.auto/definitions';",
      "import { statement } from '@on.auto/workflow-host';",
      "import { Effect } from 'effect';",
      '',
      'const forecasts = (ports) => ({',
      '  capability: defineCapability({',
      "    type: 'prediction',",
      "    title: 'Prediction',",
      "    guide: { name: 'prediction-function' },",
      "    noun: { one: 'prediction function', other: 'prediction functions' },",
      "    describeOutput: () => 'Acme answered.',",
      "    mediaType: 'text/markdown',",
      '    parse: (source) => Effect.succeed(source),',
      '    summarize: () => ({}),',
      '    run: (_source, input) =>',
      '      Effect.map(Effect.orDie(ports.database.read(statement`SELECT 1 AS answered`)), (rows) => ({',
      "        output: { question: input, rows, region: ports.settings.get('REGION') },",
      '        record: { answered_by: answeredBy },',
      '      })),',
      '  }),',
      '});',
      '',
      'export const manifest = {',
      "  name: '@acme/forecasts',",
      "  version: '1.0.0',",
      "  provides: [{ point: 'capability/prediction', contract: 1, implementation: forecasts }],",
      '};',
      '',
    ].join('\n'),
  },
};

const runsApart = 'The runtime runs in a process of its own';

function launchedIn(home: string, packageRoot: string): Promise<LaunchedRuntime> {
  const { spawn, answering } = launching();
  const settings = {
    PATH: process.env['PATH'],
    HOME: home,
    XDG_CACHE_HOME: join(home, 'cache'),
    PORT: '0',
    DO_NOT_TRACK: '1',
    SERVE_STUDIO: 'false',
    AUTO_RUNTIME_EXTENSIONS: JSON.stringify([{ package: '@acme/forecasts' }]),
    AUTO_RUNTIME_ACME_FORECASTS_REGION: 'north',
  };
  const host = {
    versions: process.versions,
    argv: [process.execPath, join(home, 'node_modules', '.bin', 'auto-runtime')],
    env: settings,
    execPath: process.execPath,
    execve: (file: string, args: readonly string[] = [], env: Readonly<NodeJS.ProcessEnv> = {}): never => {
      spawn(file, args.slice(1), { cwd: home, env });
      throw new Error(runsApart);
    },
    stderr: process.stderr,
  };
  expect(() => launch(host, pathToFileURL(`${packageRoot}/`))).toThrow(runsApart);
  return answering;
}

function launchedWithAnExtension(): Promise<LaunchedRuntime> {
  const home = scratchFolder();
  npmInstalledIn(home, [words, forecasts]);
  return launchedIn(home, runtimeInstalledIn(join(home, 'node_modules')));
}

async function posted(url: string, body: unknown): Promise<unknown> {
  const answer = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return answer.json();
}

describe('an extension installed beside the runtime of the npm package', () => {
  it('imports the packages of the release by their names, and fills capability/prediction of the runtime the launcher runs', async () => {
    const runtime = await launchedWithAnExtension();
    const playbook = `${runtime.url}/v1/orgs/local/playbooks/alpha`;
    await posted(`${runtime.url}/v1/orgs/local/playbooks`, { playbook: 'alpha', name: 'Alpha' });
    await posted(`${playbook}/definitions/prediction`, { name: 'daily-visits', source: dailyVisits });

    const answer = await posted(`${playbook}/definitions/prediction/daily-visits/run`, { input: { series: 'north' } });
    await runtime.stopped();

    expect(answer).toMatchObject({
      status: 'succeeded',
      output: { question: { series: 'north' }, rows: [{ answered: 1 }], region: 'north' },
      record: { answered_by: '@acme/forecasts, in its own words' },
    });
  });
});

function written(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

interface Installation {
  readonly installed: string;
  readonly packageRoot: string;
  readonly cache: string;
}

const extending = JSON.stringify({ name: '@acme/forecasts', peerDependencies: { '@on.auto/runtime': '*' } });

function installation(): Installation {
  const root = scratchFolder();
  const installed = join(root, 'npx', 'node_modules');
  const packageRoot = join(installed, '@on.auto', 'runtime');
  written(join(packageRoot, 'package.json'), JSON.stringify({ name: '@on.auto/runtime', version: '0.6.0' }));
  mkdirSync(join(packageRoot, 'packages'));
  mkdirSync(join(packageRoot, 'capabilities'));
  written(join(installed, '@acme', 'forecasts', 'package.json'), extending);
  written(join(installed, '@acme', 'forecasts', 'lib', 'words.js'), 'export const word = 1;\n');
  return { installed, packageRoot, cache: join(root, 'cache') };
}

function placedOf(release: string): string {
  return readlinkSync(join(release, 'node_modules', '@acme', 'forecasts'));
}

describe('an extension the launcher places in the release it runs', () => {
  it('is copied once for what was installed, linked where the release imports it, kept while a server may run from it, and linked as installed once it no longer names the runtime', () => {
    const { installed, packageRoot, cache } = installation();
    const release = installedRelease(packageRoot, cache);
    const first = placedOf(release);
    writeFileSync(join(first, 'kept'), '');

    installedRelease(packageRoot, cache);
    const again = placedOf(release);
    written(join(installed, '@acme', 'forecasts', 'lib', 'words.js'), 'export const word = 2;\n');
    installedRelease(packageRoot, cache);
    const upgraded = placedOf(release);
    written(join(installed, '@acme', 'forecasts', 'package.json'), '{"name":"@acme/forecasts"}');
    installedRelease(packageRoot, cache);

    expect([
      dirname(dirname(dirname(first))),
      again,
      existsSync(join(first, 'kept')),
      readFileSync(join(upgraded, 'lib', 'words.js'), 'utf8'),
      existsSync(join(first, 'lib', 'words.js')),
      placedOf(release),
    ]).toEqual([
      join(release, 'extensions'),
      first,
      true,
      'export const word = 2;\n',
      true,
      join(installed, '@acme', 'forecasts'),
    ]);
  });

  it('is known by the integrity npm records for it, so a package npm left as it was is not copied again', () => {
    const { installed, packageRoot, cache } = installation();
    const recorded = { packages: { 'node_modules/@acme/forecasts': { version: '1.0.0', integrity: 'sha512-A' } } };
    written(join(installed, '.package-lock.json'), JSON.stringify(recorded));
    const release = installedRelease(packageRoot, cache);
    written(join(installed, '@acme', 'forecasts', 'lib', 'words.js'), 'export const word = 2;\n');

    installedRelease(packageRoot, cache);

    expect(readFileSync(join(placedOf(release), 'lib', 'words.js'), 'utf8')).toBe('export const word = 1;\n');
  });
});

describe('the place of an extension in the release', () => {
  it('is kept when another launch filled it first, the copy of this one removed, and refused where there is neither', () => {
    const root = scratchFolder();
    written(join(root, 'place', 'kept'), '');
    written(join(root, 'copy', 'copied'), '');

    movedIntoPlace(join(root, 'copy'), join(root, 'place'));

    expect([existsSync(join(root, 'copy')), existsSync(join(root, 'place', 'kept'))]).toEqual([false, true]);
    expect(() => {
      movedIntoPlace(join(root, 'missing'), join(root, 'nowhere'));
    }).toThrow(/ENOENT/u);
  });
});
