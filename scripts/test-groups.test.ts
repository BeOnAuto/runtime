import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import { Schema } from 'effect';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');

const scope = '@on.auto/';

const everyFolderIn = '/*';

function textOf(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

const workspaceOf = Schema.decodeUnknownSync(Schema.Struct({ packages: Schema.Array(Schema.String) }));

const manifestOf = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      name: Schema.String,
      scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
);

const testEnvironmentOf = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ tasks: Schema.Struct({ test: Schema.Struct({ env: Schema.Array(Schema.String) }) }) }),
  ),
);

const testGroupsOf = Schema.decodeUnknownSync(
  Schema.Struct({
    jobs: Schema.Struct({
      test: Schema.Struct({
        strategy: Schema.Struct({
          matrix: Schema.Struct({
            include: Schema.Array(
              Schema.Struct({
                packages: Schema.Array(Schema.String),
                shard: Schema.optionalKey(Schema.Struct({ index: Schema.Number, count: Schema.Number })),
                services: Schema.Boolean,
              }),
            ),
          }),
        }),
      }),
    }),
  }),
);

const stepsOf = Schema.decodeUnknownSync(
  Schema.Struct({
    jobs: Schema.Record(
      Schema.String,
      Schema.Struct({
        steps: Schema.Array(
          Schema.Struct({
            run: Schema.optionalKey(Schema.String),
            env: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
          }),
        ),
      }),
    ),
  }),
);

function isFolderOrEveryFolderIn(pattern: string): boolean {
  const folder = pattern.endsWith(everyFolderIn) ? pattern.slice(0, -everyFolderIn.length) : pattern;
  return folder !== '' && !folder.includes('*') && !folder.startsWith('!');
}

function foldersMatching(pattern: string): readonly string[] {
  if (!pattern.endsWith(everyFolderIn)) {
    return [pattern];
  }
  const parent = pattern.slice(0, -everyFolderIn.length);
  return readdirSync(join(root, parent))
    .map((name) => `${parent}/${name}`)
    .filter((folder) => existsSync(join(root, folder, 'package.json')));
}

type Manifest = ReturnType<typeof manifestOf>;

interface ManifestIn {
  readonly folder: string;
  readonly manifest: Manifest;
}

interface TestedPackage {
  readonly name: string;
  readonly folder: string;
}

interface Shard {
  readonly index: number;
  readonly count: number;
}

interface TestGroup {
  readonly names: readonly string[];
  readonly shard: Shard | undefined;
  readonly services: boolean;
}

const workspacePatterns = workspaceOf(parse(textOf('pnpm-workspace.yaml'))).packages;

const testedPackages: readonly TestedPackage[] = workspacePatterns
  .flatMap((pattern) => foldersMatching(pattern))
  .map((folder): ManifestIn => ({ folder, manifest: manifestOf(textOf(`${folder}/package.json`)) }))
  .filter(({ manifest }) => manifest.scripts?.['test'] !== undefined)
  .map(({ folder, manifest }): TestedPackage => ({ name: manifest.name, folder }));

const workflow: unknown = parse(textOf('.github/workflows/ci.yml'));

const groups = testGroupsOf(workflow).jobs.test.strategy.matrix.include.map(
  ({ packages, shard, services }): TestGroup => ({ names: packages.map((name) => `${scope}${name}`), shard, services }),
);

const variablesOfTheTests = testEnvironmentOf(textOf('turbo.json')).tasks.test.env;

const jobs = stepsOf(workflow).jobs;

const kmsJob = 'kms';

function variablesSetBy(job: string): readonly string[] {
  return (jobs[job]?.steps ?? [])
    .flatMap(({ env }) => Object.keys(env ?? {}))
    .filter((name) => variablesOfTheTests.includes(name));
}

const variablesOfTheServices = variablesSetBy('test');

const variablesOfKms = variablesSetBy(kmsJob);

const variablesSetByAJob = new Set([...variablesOfTheServices, ...variablesOfKms]);

function readsAnyOf({ folder }: TestedPackage, variables: readonly string[]): boolean {
  const sources = join(root, folder, 'src');
  return readdirSync(sources, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .some((file) => {
      const source = readFileSync(join(sources, file), 'utf8');
      return variables.some((variable) => source.includes(variable));
    });
}

function packagesRunBy(job: string): readonly string[] {
  return (jobs[job]?.steps ?? []).flatMap(({ run = '' }) =>
    [...run.matchAll(/--filter (@on\.auto\/[\w-]+) test/gu)].map(([, name = '']: readonly string[]) => name),
  );
}

await test('the workspace names its packages by folder, or as every folder in a folder, so the groups can be checked against it', () => {
  assert.deepEqual(
    workspacePatterns.filter((pattern) => !isFolderOrEveryFolderIn(pattern)),
    [],
  );
  assert.ok(testedPackages.length > 20);
});

function shardsOf(name: string): readonly (Shard | undefined)[] {
  return groups.filter(({ names }) => names.includes(name)).map(({ shard }) => shard);
}

function everyShardOf(count: number): readonly Shard[] {
  return Array.from({ length: count }, (_, position) => ({ index: position + 1, count }));
}

function runsInOneGroupOrInEachOfItsShards(shards: readonly (Shard | undefined)[]): boolean {
  return (
    isDeepStrictEqual(shards, [undefined]) ||
    (shards.length > 0 && isDeepStrictEqual(shards, everyShardOf(shards.length)))
  );
}

await test('every package with tests runs in exactly one group of the test job, or once in each of its shards in order, and every name in a group is such a package', () => {
  const grouped = groups.flatMap(({ names }) => names);
  const tested = testedPackages.map(({ name }) => name);
  assert.deepEqual(
    tested.filter((name) => !runsInOneGroupOrInEachOfItsShards(shardsOf(name))),
    [],
  );
  assert.deepEqual(
    grouped.filter((member) => !tested.includes(member)),
    [],
  );
});

await test('a group starts PostgreSQL and the object store exactly when the tests of one of its packages read the variables that reach them', () => {
  const readers = testedPackages.filter((tested) => readsAnyOf(tested, variablesOfTheServices)).map(({ name }) => name);
  assert.ok(variablesOfTheServices.length > 0);
  assert.ok(readers.length > 0);
  assert.deepEqual(
    groups
      .filter(({ names, services }) => services !== names.some((name) => readers.includes(name)))
      .map(({ names }) => names.join(' ')),
    [],
  );
});

await test('the job against moto runs the tests of exactly the packages that read the variables it sets, and every variable that reaches the tests is set by it or by the test job', () => {
  const readers = testedPackages.filter((tested) => readsAnyOf(tested, variablesOfKms)).map(({ name }) => name);
  assert.ok(variablesOfKms.length > 0);
  assert.ok(readers.length > 0);
  assert.deepEqual(packagesRunBy(kmsJob), readers);
  assert.deepEqual(
    variablesOfTheTests.filter((name) => !variablesSetByAJob.has(name)),
    [],
  );
});
