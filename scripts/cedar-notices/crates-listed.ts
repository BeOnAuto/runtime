import { Schema } from 'effect';

export const wasmTarget = 'wasm32-unknown-unknown';

export interface ListedCrate {
  readonly name: string;
  readonly version: string;
  readonly folder: string | undefined;
}

interface Root {
  readonly packageName: string;
  readonly features: readonly string[];
}

export type Cargo = (commandArguments: readonly string[]) => string;

const listedLine = /^(?<name>\S+) v(?<version>\S+)(?: \((?<folder>\/[^)]+)\))?(?: \(proc-macro\))?(?: \(\*\))?$/u;

const MetadataSchema = Schema.Struct({
  packages: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, version: Schema.String })),
  resolve: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        deps: Schema.Array(
          Schema.Struct({
            pkg: Schema.String,
            dep_kinds: Schema.Array(Schema.Struct({ kind: Schema.NullOr(Schema.String) })),
          }),
        ),
      }),
    ),
  }),
});

const decodeMetadata = Schema.decodeUnknownSync(Schema.fromJsonString(MetadataSchema));

export function crateKey({ name, version }: Readonly<{ name: string; version: string }>): string {
  return `${name} ${version}`;
}

function featuresArguments(features: readonly string[]): readonly string[] {
  return features.length === 0 ? [] : ['--features', features.join(' ')];
}

export function treeArguments({ packageName, features }: Readonly<Root>, edges: string): readonly string[] {
  return [
    'tree',
    '--frozen',
    '--target',
    wasmTarget,
    '--package',
    packageName,
    ...featuresArguments(features),
    '--edges',
    edges,
    '--prefix',
    'none',
    '--no-dedupe',
    '--format',
    '{p}',
  ];
}

function metadataArguments(): readonly string[] {
  return ['metadata', '--format-version', '1', '--frozen', '--filter-platform', wasmTarget];
}

function crateOn(line: string): ListedCrate {
  const groups = listedLine.exec(line)?.groups;
  if (groups === undefined) {
    throw new Error(`cargo tree listed a line this script cannot read: ${line}`);
  }
  const { name = '', version = '', folder } = groups;
  return { name, version, folder };
}

function inOrder(crates: Iterable<ListedCrate>): readonly ListedCrate[] {
  return [...new Map([...crates].map((crate) => [crateKey(crate), crate])).values()].toSorted((one, other) =>
    crateKey(one).localeCompare(crateKey(other)),
  );
}

export function cratesListed(listed: string): readonly ListedCrate[] {
  return inOrder(
    listed
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => crateOn(line)),
  );
}

export function buildDependenciesOf(metadata: string, ownCrates: ReadonlySet<string>): ReadonlySet<string> {
  const { packages, resolve } = decodeMetadata(metadata);
  const keyOf = new Map(packages.map((listed) => [listed.id, crateKey(listed)]));
  return new Set(
    resolve.nodes
      .filter(({ id }) => ownCrates.has(keyOf.get(id) ?? ''))
      .flatMap(({ deps }) => deps.filter(({ dep_kinds: kinds }) => kinds.some(({ kind }) => kind === 'build')))
      .map(({ pkg }) => keyOf.get(pkg) ?? pkg),
  );
}

export function cratesCompiledIn(root: Readonly<Root>, cargo: Cargo) {
  const normal = cratesListed(cargo(treeArguments(root, 'normal')));
  const built = cratesListed(cargo(treeArguments(root, 'normal,build')));
  const ownCrates = new Set(normal.filter(({ folder }) => folder !== undefined).map((crate) => crateKey(crate)));
  const ofOwnCrates = buildDependenciesOf(cargo(metadataArguments()), ownCrates);
  const generators = built.filter((crate) => crate.folder === undefined && ofOwnCrates.has(crateKey(crate)));
  return { crates: inOrder([...normal, ...generators]), generators: generators.map((crate) => crateKey(crate)) };
}
