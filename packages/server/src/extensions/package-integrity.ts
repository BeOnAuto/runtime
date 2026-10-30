import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Option, Schema } from 'effect';

const nestedPackages = 'node_modules';

interface PackageFile {
  readonly path: string;
  readonly relative: string;
}

const BundledSchema = Schema.optional(Schema.Union([Schema.Array(Schema.String), Schema.Boolean]));

const decodeBundling = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      dependencies: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      bundleDependencies: BundledSchema,
      bundledDependencies: BundledSchema,
    }),
  ),
);

async function filesUnder(
  directory: string,
  relative: string,
  withNestedPackages: boolean,
): Promise<readonly PackageFile[]> {
  const entries = await readdir(join(directory, relative), { withFileTypes: true });
  const found = await Promise.all(
    entries.map((entry: Readonly<Dirent>) => filesOfAnEntry(directory, relative, entry, withNestedPackages)),
  );
  return found.flat();
}

function filesOfAnEntry(
  directory: string,
  relative: string,
  entry: Readonly<Dirent>,
  withNestedPackages: boolean,
): Promise<readonly PackageFile[]> {
  const inside = relative === '' ? entry.name : `${relative}/${entry.name}`;
  if (entry.isSymbolicLink()) {
    return Promise.reject(
      new Error(`The package holds a symbolic link at ${inside}, which its integrity does not cover`),
    );
  }
  if (entry.isDirectory()) {
    return entry.name === nestedPackages && !withNestedPackages
      ? Promise.resolve([])
      : filesUnder(directory, inside, withNestedPackages);
  }
  return Promise.resolve([{ path: join(directory, inside), relative: inside }]);
}

function manifestTextOf(directory: string, files: readonly PackageFile[]): Promise<string> {
  return files.some(({ relative }) => relative === 'package.json')
    ? readFile(join(directory, 'package.json'), 'utf8')
    : Promise.resolve('');
}

function bundledNames(manifest: string): ReadonlySet<string> {
  return Option.match(decodeBundling(manifest), {
    onNone: () => new Set(),
    onSome: ({ dependencies, bundleDependencies, bundledDependencies }) => {
      const bundled = bundleDependencies ?? bundledDependencies ?? false;
      if (bundled === true) {
        return new Set(Object.keys({ ...dependencies }));
      }
      return new Set(bundled === false ? [] : bundled);
    },
  });
}

function byTheirBytes(one: PackageFile, other: PackageFile): number {
  return Buffer.compare(Buffer.from(one.relative, 'utf8'), Buffer.from(other.relative, 'utf8'));
}

export async function integrityOf(directory: string): Promise<string> {
  const own = await filesUnder(directory, '', false);
  const bundled = await Promise.all(
    [...bundledNames(await manifestTextOf(directory, own))].map((name) =>
      filesUnder(directory, `${nestedPackages}/${name}`, true),
    ),
  );
  const files = [...own, ...bundled.flat()].toSorted(byTheirBytes);
  const read = await Promise.all(files.map(async ({ path, relative }) => ({ relative, bytes: await readFile(path) })));
  const hash = createHash('sha512');
  for (const { relative, bytes } of read) {
    hash.update(relative, 'utf8').update('\0').update(String(bytes.byteLength)).update('\0').update(bytes);
  }
  return `sha512-${hash.digest('base64')}`;
}
