import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ExtensionManifestSchema,
  firstLineOf,
  type ExtensionManifest,
  type ExtensionPoint,
  type ImplementationsProvided,
  type Provision,
} from '@on.auto/definitions';
import { Data, Option, Result, Schema } from 'effect';

import type { ExtensionEntry } from './extension-settings.ts';
import { integrityOf } from './package-integrity.ts';

type Provenance = 'configured' | 'release';

export interface ListedExtension extends ExtensionEntry {
  readonly provenance: Provenance;
  readonly ofTheRelease: boolean;
}

export interface LoadedExtension {
  readonly package: string;
  readonly provenance: Provenance;
  readonly name: string;
  readonly version: string;
  readonly provides: readonly { readonly point: string; readonly contract: number }[];
}

export interface LoadedExtensions {
  readonly extensions: readonly LoadedExtension[];
  readonly provided: ImplementationsProvided;
}

export interface InstalledPackages {
  readonly imported: (name: string) => Promise<unknown>;
  readonly directoryOf: (name: string) => string;
}

class ExtensionRefused extends Data.TaggedError('ExtensionRefused')<{ readonly message: string }> {}

interface Loaded {
  readonly extension: LoadedExtension;
  readonly manifest: ExtensionManifest;
}

const decodeManifest = Schema.decodeUnknownResult(ExtensionManifestSchema);

const decodeNamed = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ name: Schema.String })));

export function packageDirectoryOf(name: string, directory: string): string {
  const manifest = join(directory, 'package.json');
  const named = existsSync(manifest) ? decodeNamed(readFileSync(manifest, 'utf8')) : Option.none();
  const parent = dirname(directory);
  if (Option.isSome(named) && named.value.name === name) {
    return directory;
  }
  if (parent === directory) {
    throw new Error(`No folder above the entry of ${name} holds its package.json`);
  }
  return packageDirectoryOf(name, parent);
}

export const installedPackages: InstalledPackages = {
  imported: (name) => import(name),
  directoryOf: (name) => packageDirectoryOf(name, dirname(fileURLToPath(import.meta.resolve(name)))),
};

function refusedAs(entry: ListedExtension, detail: string): ExtensionRefused {
  return new ExtensionRefused({ message: `The extension ${entry.package} is refused: ${detail}` });
}

function listedAs(
  provenance: Provenance,
  entries: readonly ExtensionEntry[],
  releasePackages: ReadonlySet<string>,
): readonly ListedExtension[] {
  return entries.map(({ package: name, integrity }) => {
    const listed = { package: name, provenance, ofTheRelease: releasePackages.has(name) };
    return integrity === undefined ? listed : { ...listed, integrity };
  });
}

export function listedExtensions(
  configured: readonly ExtensionEntry[],
  release: readonly ExtensionEntry[],
): readonly ListedExtension[] {
  const named = new Set(configured.map((entry) => entry.package));
  const releasePackages = new Set(release.map((entry) => entry.package));
  return [
    ...listedAs('configured', configured, releasePackages),
    ...listedAs(
      'release',
      release.filter((entry) => !named.has(entry.package)),
      releasePackages,
    ),
  ];
}

async function verified(entry: ListedExtension, installed: InstalledPackages): Promise<void> {
  if (entry.integrity === undefined) {
    return;
  }
  const found = await Promise.resolve()
    .then(() => integrityOf(installed.directoryOf(entry.package)))
    .catch((error: unknown) => {
      throw refusedAs(entry, firstLineOf(error));
    });
  if (found !== entry.integrity) {
    throw refusedAs(
      entry,
      `its installed files have the integrity ${found}, and the setting names ${entry.integrity}; install the package the setting names, or name the integrity of the one installed`,
    );
  }
}

function provisionProblem(
  provision: Provision,
  points: readonly ExtensionPoint[],
  entry: ListedExtension,
): string | undefined {
  const point = points.find(({ name }) => name === provision.point);
  if (point === undefined) {
    const declared = points.map(({ name }) => name).join(', ');
    const unknown = `it provides ${provision.point}, which no capability of this runtime declares`;
    return declared === '' ? unknown : `${unknown}; the points declared are ${declared}`;
  }
  const { least, most } = point.contracts;
  if (provision.contract < least || provision.contract > most) {
    return `it provides ${provision.point} built against contract ${provision.contract}, and this runtime accepts contracts ${least} to ${most}`;
  }
  const implemented = point.implementationOf(provision.implementation);
  if (Result.isFailure(implemented)) {
    return `its implementation of ${provision.point} is refused: ${implemented.failure}`;
  }
  return entry.ofTheRelease ? undefined : point.reservedForTheRelease?.(implemented.success);
}

async function loadedOne(
  entry: ListedExtension,
  points: readonly ExtensionPoint[],
  installed: InstalledPackages,
): Promise<Loaded> {
  await verified(entry, installed);
  const module = await Promise.resolve()
    .then(() => installed.imported(entry.package))
    .catch((error: unknown) => {
      throw refusedAs(entry, `it could not be imported: ${firstLineOf(error)}`);
    });
  const exported: unknown = Reflect.get(new Object(module), 'manifest');
  if (exported === undefined) {
    throw refusedAs(entry, 'it exports no manifest; an extension exports its manifest as manifest');
  }
  const manifest = Result.getOrThrowWith(decodeManifest(exported), ({ message }: { readonly message: string }) =>
    refusedAs(entry, `its manifest is malformed: ${message}`),
  );
  if (manifest.name !== entry.package) {
    throw refusedAs(
      entry,
      `its manifest names the package ${manifest.name}, and an extension's manifest names its own package`,
    );
  }
  const problem = manifest.provides
    .map((provision) => provisionProblem(provision, points, entry))
    .find((found) => found !== undefined);
  if (problem !== undefined) {
    throw refusedAs(entry, problem);
  }
  const { name, version, provides } = manifest;
  return {
    manifest,
    extension: {
      package: entry.package,
      provenance: entry.provenance,
      name,
      version,
      provides: provides.map(({ point, contract }) => ({ point, contract })),
    },
  };
}

function providedBy(loaded: readonly Loaded[]): LoadedExtensions['provided'] {
  return (point) =>
    loaded
      .flatMap(({ manifest }) => manifest.provides)
      .filter((provision) => provision.point === point.name)
      .map((provision) => Result.getOrThrow(point.implementationOf(provision.implementation)));
}

export async function loadedExtensions(
  listed: readonly ListedExtension[],
  points: readonly ExtensionPoint[],
  installed: InstalledPackages = installedPackages,
): Promise<LoadedExtensions> {
  const loaded = await listed.reduce<Promise<readonly Loaded[]>>(
    async (before, entry) => [...(await before), await loadedOne(entry, points, installed)],
    Promise.resolve([]),
  );
  return { extensions: loaded.map(({ extension }) => extension), provided: providedBy(loaded) };
}
