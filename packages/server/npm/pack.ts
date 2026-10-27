import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isBuiltin, stripTypeScriptTypes } from 'node:module';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';

import { bareSpecifiersIn } from './imported-packages.ts';
import { aliasedNamesOf, readmeWithAlias, subpathsOf, type PackedPackage } from './package-subpaths.ts';
import { importedSubpaths } from './subpath-check.ts';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const distribution = join(repository, 'dist');
const output = join(distribution, 'npm');
const workspaceGroups: readonly string[] = ['packages', 'capabilities'];
const developmentSources = join(repository, 'packages', 'server', 'src', 'development');
const testHelperImports: readonly string[] = [
  '@modelcontextprotocol/sdk',
  'ajv',
  'ajv-formats',
  'typescript',
  'vitest',
];

const Names = Schema.Record(Schema.String, Schema.String);

const manifestOf = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      name: Schema.String,
      version: Schema.optionalKey(Schema.String),
      license: Schema.optionalKey(Schema.String),
      engines: Schema.optionalKey(Names),
      exports: Schema.optionalKey(Names),
      dependencies: Schema.optionalKey(Names),
      optionalDependencies: Schema.optionalKey(Names),
    }),
  ),
);

const installedOf = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ version: Schema.String })));

type Manifest = ReturnType<typeof manifestOf>;

interface WorkspacePackage {
  readonly directory: string;
  readonly manifest: Manifest;
}

function manifestIn(directory: string): Manifest {
  return manifestOf(readFileSync(join(directory, 'package.json'), 'utf8'));
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const workspace: ReadonlyMap<string, WorkspacePackage> = new Map(
  workspaceGroups.flatMap((group) =>
    readdirSync(join(repository, group))
      .map((name) => join(group, name))
      .filter((directory) => existsSync(join(repository, directory, 'package.json')))
      .map((directory): [string, WorkspacePackage] => {
        const manifest = manifestIn(join(repository, directory));
        return [manifest.name, { directory, manifest }];
      }),
  ),
);

function packageNamed(name: string): WorkspacePackage {
  const found = workspace.get(name);
  if (found === undefined) {
    throw new Error(`No workspace package is named ${name}`);
  }
  return found;
}

function isWorkspace(specification: string): boolean {
  return specification.startsWith('workspace:');
}

function dependencyEntries({ manifest }: WorkspacePackage): readonly (readonly [string, string])[] {
  return Object.entries(manifest.dependencies ?? {});
}

function closureOf(names: readonly string[], reached: ReadonlySet<string>): ReadonlySet<string> {
  const reachedNow = names.filter((name) => !reached.has(name));
  if (reachedNow.length === 0) {
    return reached;
  }
  const following = reachedNow.flatMap((name) =>
    dependencyEntries(packageNamed(name))
      .filter(([, specification]: readonly [string, string]) => isWorkspace(specification))
      .map(([dependency]: readonly [string, string]) => dependency),
  );
  return closureOf(following, new Set([...reached, ...reachedNow]));
}

function isTestingFolder(name: string): boolean {
  return name === 'testing' || name.endsWith('-testing');
}

function offersTesting({ manifest }: WorkspacePackage): boolean {
  return Object.hasOwn(manifest.exports ?? {}, './testing');
}

function isShipped(shipped: WorkspacePackage, source: string): boolean {
  const name = basename(source);
  return (
    !name.endsWith('.test.ts') && source !== developmentSources && (offersTesting(shipped) || !isTestingFolder(name))
  );
}

function packedOf(shipped: WorkspacePackage): PackedPackage {
  const { directory, manifest } = shipped;
  return {
    name: manifest.name,
    directory,
    exports: Object.fromEntries(
      Object.entries(manifest.exports ?? {}).filter(([, target]: readonly [string, string]) =>
        existsSync(join(output, directory, target)),
      ),
    ),
  };
}

function installedIn(directory: string, dependency: string): string {
  return join(repository, directory, 'node_modules', dependency);
}

function installedVersion({ directory }: WorkspacePackage, dependency: string): string {
  return installedOf(readFileSync(join(installedIn(directory, dependency), 'package.json'), 'utf8')).version;
}

function dependenciesOf(names: readonly string[]): Readonly<Record<string, string>> {
  const chosen = new Map<string, string>();
  for (const name of names) {
    const shipped = packageNamed(name);
    for (const [dependency, specification] of dependencyEntries(shipped).filter(
      ([, wanted]: readonly [string, string]) => !isWorkspace(wanted),
    )) {
      const resolved = specification.startsWith('catalog:') ? installedVersion(shipped, dependency) : specification;
      const earlier = chosen.get(dependency) ?? resolved;
      if (earlier !== resolved) {
        throw new Error(`${dependency} is wanted at ${earlier} and at ${resolved}`);
      }
      chosen.set(dependency, resolved);
    }
  }
  return Object.fromEntries(
    [...chosen].toSorted(([first]: readonly [string, string], [second]: readonly [string, string]) =>
      first.localeCompare(second),
    ),
  );
}

function installedDependencies(packages: readonly WorkspacePackage[]): ReadonlyMap<string, string> {
  return new Map(
    packages.flatMap((shipped) =>
      dependencyEntries(shipped)
        .filter(([, specification]: readonly [string, string]) => !isWorkspace(specification))
        .map(([dependency]: readonly [string, string]): [string, string] => [
          dependency,
          installedIn(shipped.directory, dependency),
        ]),
    ),
  );
}

function installedTestHelpers(packages: readonly WorkspacePackage[]): ReadonlyMap<string, string> {
  return new Map(
    ['.', ...packages.map(({ directory }) => directory)]
      .flatMap((directory) =>
        testHelperImports.map((helper): [string, string] => [helper, installedIn(directory, helper)]),
      )
      .filter(([, installed]: readonly [string, string]) => existsSync(installed)),
  );
}

function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return (specifier.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)).join('/');
}

function undeclaredImports(known: ReadonlySet<string>): readonly string[] {
  return readdirSync(output, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .flatMap((file) =>
      bareSpecifiersIn(stripTypeScriptTypes(readFileSync(join(output, file), 'utf8')))
        .filter((specifier) => !isBuiltin(specifier) && !known.has(packageNameOf(specifier)))
        .map((specifier) => `${file}: ${specifier}`),
    );
}

const root = manifestIn(repository);
const shippedNames = [...closureOf(['@on.auto/server'], new Set())].toSorted();
const shippedPackages = shippedNames.map((name) => packageNamed(name));

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const shipped of shippedPackages) {
  cpSync(join(repository, shipped.directory, 'src'), join(output, shipped.directory, 'src'), {
    recursive: true,
    filter: (source) => isShipped(shipped, source),
  });
}

const extras = [
  'LICENSE',
  'auto-runtime.schema.json',
  'auto-runtime.example.yaml',
  'docs/concepts/terminology.md',
  ...readdirSync(join(repository, 'docs', 'reference'))
    .filter((name) => name.endsWith('-format.md'))
    .map((name) => `docs/reference/${name}`),
  'docs/reference/template.md',
  'packages/definitions/lib',
  'packages/server/auto-runtime.ts',
];
for (const extra of extras) {
  cpSync(join(repository, extra), join(output, extra), { recursive: true });
}
const packed = shippedPackages.map((shipped) => packedOf(shipped));
const aliasedNames = aliasedNamesOf(packed);
const subpaths = subpathsOf(packed);
writeFileSync(
  join(output, 'README.md'),
  readmeWithAlias(
    readFileSync(join(repository, 'packages', 'server', 'npm', 'README.md'), 'utf8'),
    root.name,
    aliasedNames,
  ),
);

for (const { name, directory, exports } of packed) {
  writeFileSync(join(output, directory, 'package.json'), json({ name, type: 'module', exports }));
}

const dependencies = dependenciesOf(shippedNames);
const optional = shippedPackages.flatMap(({ manifest }) => Object.keys(manifest.optionalDependencies ?? {}));
const undeclared = undeclaredImports(
  new Set([...shippedNames, ...Object.keys(dependencies), ...optional, ...testHelperImports]),
);
if (undeclared.length > 0) {
  throw new Error(`The package imports what it does not declare:\n${undeclared.join('\n')}`);
}

writeFileSync(
  join(output, 'package.json'),
  json({
    name: root.name,
    version: root.version,
    description:
      'Auto Runtime runs the playbooks your agent builds: their reasoning, interaction, prediction, recall and computation functions, and the workflows that coordinate them.',
    keywords: ['auto', 'playbooks', 'workflows', 'mcp', 'agents', 'runtime'],
    homepage: 'https://on.auto/docs/',
    bugs: { url: 'https://github.com/BeOnAuto/runtime/issues' },
    repository: { type: 'git', url: 'git+https://github.com/BeOnAuto/runtime.git' },
    license: root.license,
    type: 'module',
    exports: subpaths,
    bin: { 'auto-runtime': 'bin/auto-runtime.js' },
    engines: root.engines,
    os: ['darwin', 'linux'],
    publishConfig: { access: 'public' },
    dependencies,
  }),
);

mkdirSync(join(output, 'bin'));
writeFileSync(
  join(output, 'bin', 'launch.js'),
  stripTypeScriptTypes(readFileSync(join(repository, 'packages/server/src/command-line/launch.ts'), 'utf8')),
);
writeFileSync(
  join(output, 'bin', 'auto-runtime.js'),
  [
    '#!/usr/bin/env node',
    "import { launch } from './launch.js';",
    '',
    "process.exitCode = launch(process, new URL('../', import.meta.url));",
    '',
  ].join('\n'),
  { mode: 0o755 },
);

const tarball = join(distribution, `${root.name.slice(1).replace('/', '-')}-${root.version ?? ''}.tgz`);
execFileSync('npm', ['pack', '--pack-destination', distribution], { cwd: output, stdio: 'inherit' });
importedSubpaths({
  packageName: root.name,
  tarball,
  modules: new Map([...installedDependencies(shippedPackages), ...installedTestHelpers(shippedPackages)]),
  aliasedNames,
  subpaths: Object.keys(subpaths),
});
process.stdout.write(
  `Packed ${shippedNames.length} workspace packages and ${Object.keys(dependencies).length} dependencies into ${tarball}, imported its ${Object.keys(subpaths).length} subpaths and read the files it ships in a release of it\n`,
);
