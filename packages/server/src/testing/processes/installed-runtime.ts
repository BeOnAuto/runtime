import { execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { onTestFinished } from 'vitest';

const repository = fileURLToPath(new URL('../../../../../', import.meta.url));

const workspaceGroups: readonly string[] = ['packages', 'capabilities'];

const shippedBeside: readonly string[] = [
  'LICENSE',
  'auto-runtime.schema.json',
  'auto-runtime.example.yaml',
  'docs/concepts/terminology.md',
  'docs/reference',
  'packages/definitions/lib',
  'packages/server/auto-runtime.ts',
];

const Dependencies = Schema.optionalKey(Schema.Record(Schema.String, Schema.String));

const readManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ dependencies: Dependencies, optionalDependencies: Dependencies })),
);

export interface InstalledPackage {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
}

function written(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function workspaceFolders(): readonly string[] {
  return workspaceGroups.flatMap((group) =>
    readdirSync(join(repository, group))
      .map((name) => join(group, name))
      .filter((folder) => existsSync(join(repository, folder, 'package.json'))),
  );
}

function installedDependenciesOf(folder: string): readonly (readonly [string, string])[] {
  const { dependencies = {}, optionalDependencies = {} } = readManifest(
    readFileSync(join(repository, folder, 'package.json'), 'utf8'),
  );
  return Object.entries({ ...dependencies, ...optionalDependencies })
    .filter(([, wanted]: readonly [string, string]) => !wanted.startsWith('workspace:'))
    .map(([name]: readonly [string, string]) => [name, join(repository, folder, 'node_modules', name)] as const)
    .filter(([, installed]: readonly [string, string]) => existsSync(installed));
}

function copiedRelease(packageRoot: string, folders: readonly string[]): void {
  for (const folder of folders) {
    cpSync(join(repository, folder, 'package.json'), join(packageRoot, folder, 'package.json'));
    cpSync(join(repository, folder, 'src'), join(packageRoot, folder, 'src'), {
      recursive: true,
      filter: (source) => !source.endsWith('.test.ts'),
    });
  }
  for (const extra of shippedBeside) {
    cpSync(join(repository, extra), join(packageRoot, extra), { recursive: true });
  }
  written(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: '@on.auto/runtime', version: '0.0.0', type: 'module' }),
  );
}

function linkedDependencies(installed: string, folders: readonly string[]): void {
  const dependencies = new Map(folders.flatMap((folder) => installedDependenciesOf(folder)).toReversed());
  for (const [name, found] of dependencies) {
    mkdirSync(dirname(join(installed, name)), { recursive: true });
    symlinkSync(realpathSync(found), join(installed, name));
  }
}

export function runtimeInstalledIn(installed: string): string {
  const packageRoot = join(installed, '@on.auto', 'runtime');
  const folders = workspaceFolders();
  copiedRelease(packageRoot, folders);
  linkedDependencies(installed, folders);
  return packageRoot;
}

function npmOf(home: string): NodeJS.ProcessEnv {
  return { ...process.env, npm_config_cache: join(home, 'npm-cache'), NODE_DISABLE_COMPILE_CACHE: '1' };
}

function packed(home: string, { name, files }: InstalledPackage): string {
  const source = join(home, 'sources', name);
  for (const [file, text] of Object.entries(files)) {
    written(join(source, file), text);
  }
  const tarball = execFileSync('npm', ['pack', '--silent', '--pack-destination', join(home, 'sources')], {
    cwd: source,
    env: npmOf(home),
    encoding: 'utf8',
  });
  return join(home, 'sources', tarball.trim());
}

export function npmInstalledIn(home: string, packages: readonly InstalledPackage[]): void {
  written(join(home, 'package.json'), JSON.stringify({ name: 'program', private: true }));
  const tarballs = packages.map((each) => packed(home, each));
  execFileSync(
    'npm',
    ['install', '--offline', '--no-audit', '--no-fund', '--legacy-peer-deps', '--ignore-scripts', ...tarballs],
    { cwd: home, env: npmOf(home), stdio: 'ignore' },
  );
}

export function scratchFolder(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'auto-runtime-launched-')));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

export interface LaunchedRuntime {
  readonly url: string;
  readonly stopped: () => Promise<unknown>;
}

interface Launching {
  readonly spawn: (file: string, args: readonly string[], options: SpawnOptions) => void;
  readonly answering: Promise<LaunchedRuntime>;
}

interface SpawnOptions {
  readonly cwd: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
}

async function answeringOnceSpawned(spawned: Promise<ChildProcess>): Promise<LaunchedRuntime> {
  const child = await spawned;
  const output = { written: '' };
  const { promise: shown, resolve } = Promise.withResolvers<string>();
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding('utf8').on('data', (chunk: string) => {
      output.written += chunk;
      const url = /Server {3}(?<url>http:\/\/localhost:\d+)/u.exec(output.written)?.groups?.['url'];
      if (url !== undefined) {
        resolve(url);
      }
    });
  }
  const exited = once(child, 'exit');
  const stoppedFirst = exited.then(() => {
    throw new Error(`The runtime stopped before it answered: ${output.written}`);
  });
  const url = await Promise.race([shown, stoppedFirst]);
  return {
    url,
    stopped: () => {
      child.kill('SIGINT');
      return exited;
    },
  };
}

export function launching(): Launching {
  const { promise: spawned, resolve } = Promise.withResolvers<ChildProcess>();
  return {
    spawn: (file, args, { cwd, env }) => {
      resolve(spawnForTheTest(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }));
    },
    answering: answeringOnceSpawned(spawned),
  };
}
