import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';

import { Schema } from 'effect';
import ts from 'typescript6';

const root = resolve(import.meta.dirname, '..');

const theServersCommand = join(root, 'packages/server/src/main.ts');

const whereFactsAreMade = join(root, 'packages/operations/src/ledger/decider.ts');

const operations = '@on.auto/operations';

const factMaker = 'factOf';

const manifestOf = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ name: Schema.String, exports: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)) }),
  ),
);

interface WorkspacePackage {
  readonly folder: string;
  readonly exports: Readonly<Record<string, string>>;
}

const sourceGroups: readonly string[] = ['packages', 'capabilities'];

const packages: ReadonlyMap<string, WorkspacePackage> = new Map(
  sourceGroups.flatMap((group) =>
    readdirSync(join(root, group)).map((name): readonly [string, WorkspacePackage] => {
      const folder = join(root, group, name);
      const manifest = manifestOf(readFileSync(join(folder, 'package.json'), 'utf8'));
      return [manifest.name, { folder, exports: manifest.exports ?? {} }];
    }),
  ),
);

const workspaceSpecifier = /^(?<name>@on\.auto\/[^/]+)(?<subpath>\/.+)?$/u;

function entryOf(name: string, subpath: string | undefined): string | undefined {
  const found = packages.get(name);
  const entry = found?.exports[subpath === undefined ? '.' : `.${subpath}`];
  return found === undefined || entry === undefined ? undefined : join(found.folder, entry);
}

function resolvedFrom(file: string, specifier: string): string | undefined {
  if (specifier.startsWith('.')) {
    return join(dirname(file), specifier);
  }
  const groups = workspaceSpecifier.exec(specifier)?.groups;
  return groups === undefined ? undefined : entryOf(groups['name'] ?? '', groups['subpath']);
}

function textOf(node: ts.Node | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteral(node) ? node.text : undefined;
}

function isTypeOnly(node: ts.Node): boolean {
  if (ts.isImportDeclaration(node)) {
    return node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
  }
  return ts.isExportDeclaration(node) && node.isTypeOnly;
}

function declaredSpecifier(node: ts.Node): string | undefined {
  const declares = ts.isImportDeclaration(node) || ts.isExportDeclaration(node);
  return declares && !isTypeOnly(node) ? textOf(node.moduleSpecifier) : undefined;
}

function importedSpecifier(node: ts.Node): string | undefined {
  const imports = ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
  return imports ? textOf(node.arguments[0]) : undefined;
}

function makesFacts(file: string, node: ts.Node): boolean {
  const specifier = ts.isImportDeclaration(node) && !isTypeOnly(node) ? textOf(node.moduleSpecifier) : undefined;
  return specifier !== undefined && (specifier === operations || resolvedFrom(file, specifier) === whereFactsAreMade);
}

function factMakersIn(file: string, node: ts.Node): readonly string[] {
  const bindings =
    ts.isImportDeclaration(node) && makesFacts(file, node) ? node.importClause?.namedBindings : undefined;
  const makers: string[] = [];
  for (const element of bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements : []) {
    if (!element.isTypeOnly && (element.propertyName ?? element.name).text === factMaker) {
      makers.push(element.name.text);
    }
  }
  return makers;
}

interface ModuleRead {
  readonly imports: readonly string[];
  readonly types: readonly string[];
  readonly unnamed: readonly string[];
}

function madeType(node: ts.Node, makers: ReadonlySet<string>): string | undefined | null {
  const made = ts.isCallExpression(node) && ts.isIdentifier(node.expression) && makers.has(node.expression.text);
  return made ? (textOf(node.arguments[0]) ?? null) : undefined;
}

function moduleReadOf(file: string, text: string): ModuleRead {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const makers = new Set(source.statements.flatMap((statement: ts.Node) => factMakersIn(file, statement)));
  const imports: string[] = [];
  const types: string[] = [];
  const unnamed: string[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = declaredSpecifier(node) ?? importedSpecifier(node);
    const type = madeType(node, makers);
    if (specifier !== undefined) {
      imports.push(specifier);
    }
    if (typeof type === 'string') {
      types.push(type);
    }
    if (type === null) {
      unnamed.push(`${relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports, types, unnamed };
}

interface FactMade {
  readonly file: string;
  readonly type: string;
}

interface FactsReached {
  readonly made: readonly FactMade[];
  readonly unnamed: readonly string[];
}

function factsReachedFrom(entry: string): FactsReached {
  const seen = new Set<string>();
  const pending = [entry];
  const made: FactMade[] = [];
  const unnamed: string[] = [];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (!seen.has(file) && file.endsWith('.ts') && existsSync(file)) {
      seen.add(file);
      const module = moduleReadOf(file, readFileSync(file, 'utf8'));
      made.push(...module.types.map((type) => ({ file, type })));
      unnamed.push(...module.unnamed);
      pending.push(...module.imports.flatMap((specifier) => resolvedFrom(file, specifier) ?? []));
    }
  }
  return { made, unnamed };
}

const releaseFolder = /^\d+\.\d+\.\d+$/u;

const fixtureFile = /^(?<type>[a-z][a-z0-9_]*)\.json$/u;

function releasesIn(folder: string): readonly string[] {
  return readdirSync(folder).filter((name) => releaseFolder.test(name) && statSync(join(folder, name)).isDirectory());
}

function hasAFixture({ file, type }: FactMade): boolean {
  const folder = dirname(file);
  return releasesIn(folder).some((release) => existsSync(join(folder, release, `${type}.json`)));
}

interface KeptFixture {
  readonly folder: string;
  readonly type: string;
  readonly path: string;
}

function fixtureAt(sources: string, path: string): readonly KeptFixture[] {
  const parts = path.split(sep);
  const type = fixtureFile.exec(parts.at(-1) ?? '')?.groups?.['type'];
  const kept = type !== undefined && releaseFolder.test(parts.at(-2) ?? '');
  return kept ? [{ folder: join(sources, ...parts.slice(0, -2)), type, path: join(sources, path) }] : [];
}

function fixturesKeptIn({ folder }: WorkspacePackage): readonly KeptFixture[] {
  const sources = join(folder, 'src');
  return existsSync(sources)
    ? readdirSync(sources, { recursive: true, encoding: 'utf8' }).flatMap((path) => fixtureAt(sources, path))
    : [];
}

const reached = factsReachedFrom(theServersCommand);

function named(fact: FactMade): string {
  return `${relative(root, fact.file)}: ${fact.type}`;
}

await test('every fact type a module the server reaches makes has a fixture beside that module, in a folder named for the release that recorded it', () => {
  assert.deepEqual(
    reached.made.filter((fact) => !hasAFixture(fact)).map((fact) => named(fact)),
    [],
  );
  assert.ok(reached.made.some(({ type }) => type === 'input_applied'));
  assert.ok(reached.made.some(({ type }) => type === 'own_key_kept'));
});

await test('every fact a module the server reaches makes names its type in a literal, so that this gate reads each one', () => {
  assert.deepEqual(reached.unnamed, []);
});

await test('every fixture kept beside a module of the packages is of a fact type a module in its folder makes', () => {
  const made = new Set(reached.made.map(({ file, type }) => `${dirname(file)}:${type}`));
  const kept = [...packages.values()].flatMap((found) => fixturesKeptIn(found));

  assert.ok(kept.length > 0);
  assert.deepEqual(
    kept.filter(({ folder, type }) => !made.has(`${folder}:${type}`)).map(({ path }) => relative(root, path)),
    [],
  );
});

const manifestName = 'recorded-facts.json';

const manifestEntriesOf = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)));

function hashOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function manifestDifferences(found: WorkspacePackage): readonly string[] {
  const manifest = join(found.folder, manifestName);
  const listed = existsSync(manifest) ? manifestEntriesOf(readFileSync(manifest, 'utf8')) : {};
  const kept = new Map(
    fixturesKeptIn(found).map(({ path }) => [relative(found.folder, path).split(sep).join('/'), hashOf(path)]),
  );
  const inTheRepository = (key: string) => `${relative(root, found.folder)}/${key}`;
  return [
    ...Object.entries(listed).flatMap(([key, hash]: readonly [string, string]) => {
      const onDisk = kept.get(key);
      if (onDisk === undefined) {
        return [`${inTheRepository(key)} is in the manifest but gone`];
      }
      return onDisk === hash ? [] : [`${inTheRepository(key)} changed since its release recorded it`];
    }),
    ...[...kept.keys()]
      .filter((key) => !Object.hasOwn(listed, key))
      .map((key) => `${inTheRepository(key)} is not in the manifest`),
  ];
}

await test('every fixture a package keeps is in its manifest, recorded-facts.json, unchanged since it was recorded, and every fixture the manifest keeps is there', () => {
  const differences = [...packages.values()].flatMap((found) => manifestDifferences(found));

  assert.deepEqual(differences, []);
  assert.ok([...packages.values()].filter(({ folder }) => existsSync(join(folder, manifestName))).length >= 9);
});

await test('a fact is read from a call of the factOf of the operations package, under any name, and a call that names no literal type is told', () => {
  const read = moduleReadOf(
    join(root, 'packages/probe/src/probe.ts'),
    [
      "import { factOf as fact, type Decided } from '@on.auto/operations';",
      "import type { factOf as typed } from '@on.auto/operations';",
      "const Added = fact('added', data, context);",
      'const Named = fact(type, data, context);',
      "const lazily = () => import('./later.ts');",
      'function factOf(record: unknown) { return record; }',
      "factOf('not_a_fact');",
    ].join('\n'),
  );

  assert.deepEqual(read, {
    imports: ['@on.auto/operations', './later.ts'],
    types: ['added'],
    unnamed: ['packages/probe/src/probe.ts:4'],
  });
});
