import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';

const manifestName = 'recorded-facts.json';

const manifestFromText = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)));

export interface FixtureManifest {
  readonly root: string;
  readonly path: string;
}

export type ManifestEntries = Readonly<Record<string, string>>;

function folderHolding(file: string, folder: string, missing: string): string {
  if (existsSync(join(folder, file))) {
    return folder;
  }
  const parent = dirname(folder);
  if (parent === folder) {
    throw new Error(missing);
  }
  return folderHolding(file, parent, missing);
}

export function manifestOf(folder: Readonly<URL>): FixtureManifest {
  const root = folderHolding(
    'package.json',
    fileURLToPath(folder),
    'No package holds the folder of these fixtures, so they have no manifest to be kept in',
  );
  return { root, path: join(root, manifestName) };
}

const versionFromText = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ version: Schema.String })));

export function shippedVersionOf(folder: Readonly<URL>): string {
  const workspace = folderHolding(
    'pnpm-workspace.yaml',
    fileURLToPath(folder),
    'No workspace holds the folder of these fixtures, so no version says which releases have shipped',
  );
  return versionFromText(readFileSync(join(workspace, 'package.json'), 'utf8')).version;
}

export function keyOf({ root }: FixtureManifest, path: string): string {
  return relative(root, path).split(sep).join('/');
}

export function hashOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function entriesKept({ path }: FixtureManifest): ManifestEntries {
  return existsSync(path) ? manifestFromText(readFileSync(path, 'utf8')) : {};
}

const fixtureOfARelease = /^\d+\.\d+\.\d+\/[a-z][a-z0-9_]*\.json$/u;

export function entriesOf(manifest: FixtureManifest, folder: Readonly<URL>): ManifestEntries {
  const own = `${keyOf(manifest, fileURLToPath(folder))}/`;
  return Object.fromEntries(
    Object.entries(entriesKept(manifest)).filter(
      ([key]: readonly [string, string]) => key.startsWith(own) && fixtureOfARelease.test(key.slice(own.length)),
    ),
  );
}

const waitedOn = new Int32Array(new SharedArrayBuffer(4));

const lockWaitMs = 10;

function isTaken(lock: string): boolean {
  try {
    mkdirSync(lock);
    return true;
  } catch {
    return false;
  }
}

export function underTheLock<A>(manifest: FixtureManifest, work: () => A, tries = 500): A {
  const lock = `${manifest.path}.lock`;
  if (isTaken(lock)) {
    try {
      return work();
    } finally {
      rmdirSync(lock);
    }
  }
  if (tries <= 1) {
    throw new Error(`Another recording holds ${lock}; when none runs, remove it and record again`);
  }
  Atomics.wait(waitedOn, 0, 0, lockWaitMs);
  return underTheLock(manifest, work, tries - 1);
}

export function keptInTheManifest(manifest: FixtureManifest, paths: readonly string[]): void {
  underTheLock(manifest, () => {
    const entries = {
      ...entriesKept(manifest),
      ...Object.fromEntries(paths.map((path) => [keyOf(manifest, path), hashOf(path)])),
    };
    const sorted = Object.fromEntries(
      Object.entries(entries).toSorted(([one]: readonly [string, string], [other]: readonly [string, string]) =>
        one.localeCompare(other),
      ),
    );
    const written = `${manifest.path}.${process.pid}`;
    writeFileSync(written, `${JSON.stringify(sorted, null, 2)}\n`);
    renameSync(written, manifest.path);
  });
}
