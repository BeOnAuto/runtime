import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { distributionVariable } from '../usage-ping/usage-ping-settings.ts';
import { installedRelease, launch, type LaunchingProcess } from './launch.ts';

const made: string[] = [];

afterEach(() => {
  for (const directory of made.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function written(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

interface Installation {
  readonly root: string;
  readonly installed: string;
  readonly packageRoot: string;
  readonly cache: string;
}

function installation(version = '0.6.0'): Installation {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'auto-runtime-launch-')));
  made.push(root);
  const installed = join(root, 'npx', 'node_modules');
  const packageRoot = join(installed, '@on.auto', 'runtime');
  written(join(packageRoot, 'package.json'), JSON.stringify({ name: '@on.auto/runtime', version }));
  written(join(packageRoot, 'packages', 'server', 'auto-runtime.ts'), 'export {};\n');
  written(join(packageRoot, 'packages', 'ledger', 'package.json'), '{"name":"@on.auto/ledger"}');
  written(join(packageRoot, 'capabilities', 'reasoning', 'package.json'), '{"name":"@on.auto/reasoning"}');
  written(join(packageRoot, 'node_modules', 'effect', 'package.json'), '{"name":"effect","version":"nested"}');
  written(join(installed, 'effect', 'package.json'), '{"name":"effect","version":"hoisted"}');
  written(join(installed, 'pg', 'package.json'), '{"name":"pg"}');
  written(join(installed, '@aws-sdk', 'client-s3', 'package.json'), '{"name":"@aws-sdk/client-s3"}');
  written(join(installed, '@on.auto', 'ledger', 'package.json'), '{"name":"@on.auto/ledger","version":"beside"}');
  written(join(installed, '@on.auto', 'models', 'package.json'), '{"name":"@on.auto/models"}');
  written(join(installed, '@acme', 'models', 'package.json'), '{"name":"@acme/models"}');
  written(join(installed, '.bin', 'auto-runtime'), '');
  written(join(installed, '.package-lock.json'), '{}');
  return { root, installed, packageRoot, cache: join(root, 'cache') };
}

class Executed extends Error {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<NodeJS.ProcessEnv> | undefined;

  constructor(file: string, args: readonly string[], env: Readonly<NodeJS.ProcessEnv> | undefined) {
    super('executed');
    this.file = file;
    this.args = args;
    this.env = env;
  }
}

interface Launching {
  readonly host: LaunchingProcess;
  readonly messages: string[];
}

function launching(overrides: Readonly<Partial<LaunchingProcess>>): Launching {
  const messages: string[] = [];
  return {
    messages,
    host: {
      versions: { node: '26.10.0' },
      argv: ['/usr/local/bin/node', '/npx/node_modules/.bin/auto-runtime', 'key', '--org', 'acme'],
      env: { HOME: '/home/ada' },
      execPath: '/usr/local/bin/node',
      execve: (file, args, env) => {
        throw new Executed(file, args ?? [], env);
      },
      stderr: { write: (text: string) => messages.push(text) },
      ...overrides,
    },
  };
}

function urlOf(packageRoot: string): URL {
  return pathToFileURL(`${packageRoot}/`);
}

function execveCallOf(host: Readonly<LaunchingProcess>, packageRoot: string): Executed {
  try {
    launch(host, urlOf(packageRoot));
  } catch (error) {
    if (error instanceof Executed) {
      return error;
    }
    throw error;
  }
  throw new Error('launch returned without executing');
}

describe('launching the runtime from its npm package', () => {
  it('runs the command entry of an installed release with the arguments and environment it was given, marked as the npm package', () => {
    const { packageRoot, cache } = installation();
    const env = { XDG_CACHE_HOME: cache, ANTHROPIC_API_KEY: 'sk-ant-test' };

    const executed = execveCallOf(launching({ env }).host, packageRoot);

    const release = installedRelease(packageRoot, cache);
    expect(executed.file).toBe('/usr/local/bin/node');
    expect(executed.args).toEqual([
      '/usr/local/bin/node',
      join(release, 'packages', 'server', 'auto-runtime.ts'),
      'key',
      '--org',
      'acme',
    ]);
    expect(executed.env).toEqual({ ...env, [distributionVariable]: 'npx' });
    expect(dirname(release)).toBe(join(cache, 'auto-runtime'));
  });

  it('keeps the release under HOME/.cache when XDG_CACHE_HOME is not set', () => {
    const { root, packageRoot } = installation();

    const executed = execveCallOf(launching({ env: { HOME: root, XDG_CACHE_HOME: '' } }).host, packageRoot);

    expect(executed.args[1]?.startsWith(join(root, '.cache', 'auto-runtime'))).toBe(true);
  });

  it.each(['26.10.0', '26.10.1', '26.11.0', '27.0.0'])('runs on Node.js %s', (node) => {
    const { packageRoot, cache } = installation();

    const executed = execveCallOf(launching({ versions: { node }, env: { XDG_CACHE_HOME: cache } }).host, packageRoot);

    expect(executed.args[2]).toBe('key');
  });
});

describe('installing a release out of node_modules', () => {
  it('copies the sources and links the dependencies Node would find from the package, nearest first', () => {
    const { installed, packageRoot, cache } = installation();

    const release = installedRelease(packageRoot, cache);

    expect(readFileSync(join(release, 'packages', 'server', 'auto-runtime.ts'), 'utf8')).toBe('export {};\n');
    expect(readlinkSync(join(release, 'node_modules', 'effect'))).toBe(join(packageRoot, 'node_modules', 'effect'));
    expect(readlinkSync(join(release, 'node_modules', 'pg'))).toBe(join(installed, 'pg'));
    expect(readlinkSync(join(release, 'node_modules', '@aws-sdk', 'client-s3'))).toBe(
      join(installed, '@aws-sdk', 'client-s3'),
    );
  });

  it('links a package installed beside the runtime that is none of its own, such as an extension, so the runtime imports it by name', () => {
    const { installed, packageRoot, cache } = installation();

    const release = installedRelease(packageRoot, cache);

    expect([
      readlinkSync(join(release, 'node_modules', '@on.auto', 'models')),
      readlinkSync(join(release, 'node_modules', '@acme', 'models')),
    ]).toEqual([join(installed, '@on.auto', 'models'), join(installed, '@acme', 'models')]);
  });

  it('links the workspace packages to their copies, never a package of the same name beside it, and not the package itself', () => {
    const { packageRoot, cache } = installation();

    const release = installedRelease(packageRoot, cache);

    expect(readlinkSync(join(release, 'node_modules', '@on.auto', 'ledger'))).toBe(join(release, 'packages', 'ledger'));
    expect(readlinkSync(join(release, 'node_modules', '@on.auto', 'reasoning'))).toBe(
      join(release, 'capabilities', 'reasoning'),
    );
    expect(existsSync(join(release, 'node_modules', '@on.auto', 'runtime'))).toBe(false);
    expect(existsSync(join(release, 'node_modules', '.bin'))).toBe(false);
    expect(existsSync(join(release, 'node_modules', '.package-lock.json'))).toBe(false);
  });
});

describe('installing a release again', () => {
  it('installs a release once, and again only when the last install did not finish', () => {
    const { packageRoot, cache } = installation();
    const release = installedRelease(packageRoot, cache);
    writeFileSync(join(release, 'kept'), '');

    expect(installedRelease(packageRoot, cache)).toBe(release);
    expect(existsSync(join(release, 'kept'))).toBe(true);

    rmSync(join(release, '.installed'));
    installedRelease(packageRoot, cache);

    expect(existsSync(join(release, 'kept'))).toBe(false);
    expect(existsSync(join(release, '.installed'))).toBe(true);
  });

  it('links a package installed beside the runtime after its first launch, so the next launch imports it by name', () => {
    const { installed, packageRoot, cache } = installation();
    const release = installedRelease(packageRoot, cache);
    written(join(installed, '@acme', 'later-models', 'package.json'), '{"name":"@acme/later-models"}');

    expect(installedRelease(packageRoot, cache)).toBe(release);
    expect(readlinkSync(join(release, 'node_modules', '@acme', 'later-models'))).toBe(
      join(installed, '@acme', 'later-models'),
    );
  });

  it('leaves a link that points where Node would find the package, and points one that no longer does there again', () => {
    const { installed, packageRoot, cache } = installation();
    const release = installedRelease(packageRoot, cache);
    const kept = lstatSync(join(release, 'node_modules', 'pg')).ino;
    rmSync(join(packageRoot, 'node_modules', 'effect'), { recursive: true });

    installedRelease(packageRoot, cache);

    expect(lstatSync(join(release, 'node_modules', 'pg')).ino).toBe(kept);
    expect(readlinkSync(join(release, 'node_modules', 'effect'))).toBe(join(installed, 'effect'));
  });

  it('installs each version of the package apart', () => {
    const { packageRoot, cache } = installation('0.6.0');
    const release = installedRelease(packageRoot, cache);
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@on.auto/runtime', version: '0.7.0' }));

    expect(installedRelease(packageRoot, cache)).not.toBe(release);
  });
});

describe('what the launcher refuses', () => {
  it.each(['26.9.9', '25.12.0'])('refuses Node.js %s', (node) => {
    const { packageRoot, cache } = installation();
    const { host, messages } = launching({ versions: { node }, env: { XDG_CACHE_HOME: cache } });

    expect(launch(host, urlOf(packageRoot))).toBe(1);
    expect(messages).toEqual([`Auto Runtime needs Node.js 26.10.0 or later, and this is Node.js ${node}.\n`]);
  });

  it('refuses a platform without execve, such as Windows, and points to the image', () => {
    const { packageRoot } = installation();
    const { host, messages } = launching({ execve: undefined });

    expect(launch(host, urlOf(packageRoot))).toBe(1);
    expect(messages).toEqual([
      'Auto Runtime runs on macOS and Linux. On Windows, run the docker.on.auto/onauto/runtime image with Docker.\n',
    ]);
  });

  it('refuses to start without a place for its files', () => {
    const { packageRoot } = installation();
    const { host, messages } = launching({ env: {} });

    expect(launch(host, urlOf(packageRoot))).toBe(1);
    expect(messages).toEqual(['Auto Runtime keeps its files under XDG_CACHE_HOME or HOME, and neither is set.\n']);
  });
});
