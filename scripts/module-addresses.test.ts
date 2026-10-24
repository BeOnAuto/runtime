import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';

import { Schema } from 'effect';
import ts from 'typescript6';

const root = resolve(import.meta.dirname, '..');

const nodeShell = '@on.auto/server';

const addresses: ReadonlySet<string> = new Set(['url', 'resolve', 'dirname', 'filename']);

const manifestOf = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ name: Schema.String, exports: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)) }),
  ),
);

interface AddressRead {
  readonly place: string;
  readonly atLoad: boolean;
}

interface ModuleRead {
  readonly imports: readonly string[];
  readonly addresses: readonly AddressRead[];
}

function isImmediatelyCalled(node: ts.Node): boolean {
  let callee = node;
  while (ts.isParenthesizedExpression(callee.parent)) {
    callee = callee.parent;
  }
  return ts.isCallExpression(callee.parent) && callee.parent.expression === callee;
}

function isReadAtLoad(node: ts.Node): boolean {
  for (let around = node.parent; !ts.isSourceFile(around); around = around.parent) {
    if (ts.isFunctionLike(around) && !isImmediatelyCalled(around)) {
      return false;
    }
  }
  return true;
}

function textOf(specifier: ts.Node | undefined): string | undefined {
  return specifier !== undefined && ts.isStringLiteral(specifier) ? specifier.text : undefined;
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

function loadedSpecifier(node: ts.Node): string | undefined {
  return declaredSpecifier(node) ?? importedSpecifier(node);
}

function addressNamed(node: ts.Node): string | undefined {
  const isMeta =
    ts.isPropertyAccessExpression(node) &&
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword;
  return isMeta && addresses.has(node.name.text) ? node.name.text : undefined;
}

function moduleReadOf(name: string, text: string): ModuleRead {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports: string[] = [];
  const read: AddressRead[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = loadedSpecifier(node);
    const address = addressNamed(node);
    if (specifier !== undefined) {
      imports.push(specifier);
    }
    if (address !== undefined) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      read.push({ place: `${name}:${line + 1} import.meta.${address}`, atLoad: isReadAtLoad(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports, addresses: read };
}

function shippedPackages(): readonly { readonly folder: string; readonly entries: readonly string[] }[] {
  return ['packages', 'capabilities'].flatMap((group) =>
    readdirSync(join(root, group)).flatMap((name) => {
      const folder = join(root, group, name);
      const manifest = manifestOf(readFileSync(join(folder, 'package.json'), 'utf8'));
      const entries = Object.values(manifest.exports ?? {}).map((entry) => join(folder, entry));
      return manifest.name === nodeShell ? [] : [{ folder, entries }];
    }),
  );
}

function addressesReachedFrom(entries: readonly string[]): readonly AddressRead[] {
  const seen = new Set<string>();
  const pending = [...entries];
  const read: AddressRead[] = [];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (!seen.has(file) && file.endsWith('.ts')) {
      seen.add(file);
      const module = moduleReadOf(relative(root, file), readFileSync(file, 'utf8'));
      read.push(...module.addresses);
      pending.push(
        ...module.imports.filter((specifier) => specifier.startsWith('.')).map((path) => join(dirname(file), path)),
      );
    }
  }
  return read;
}

const reached = shippedPackages().flatMap(({ entries }) => addressesReachedFrom(entries));

await test('no module an entry of a shipped package reaches, but the server, reads import.meta.url or import.meta.resolve as it loads, only in a function', () => {
  assert.deepEqual(
    reached.filter(({ atLoad }) => atLoad).map(({ place }) => place),
    [],
  );
  assert.ok(reached.some(({ place }) => place.startsWith('packages/api/src/shipped-files/api-roots.ts:')));
  assert.ok(reached.some(({ place }) => place.startsWith('capabilities/reasoning/src/adapter/entra-id.ts:')));
});

await test('an address read as a module loads is told from one read in a function, a function called at once read at load', () => {
  const read = moduleReadOf(
    'probe.ts',
    [
      "import type { Kept } from './kept.ts';",
      "import { here } from './here.ts';",
      "export type { There } from './there.ts';",
      "export { beside } from './beside.ts';",
      "const root = new URL('../', import.meta.url);",
      "const later = (): string => import.meta.resolve('./later.ts');",
      'const now = (() => import.meta.filename)();',
      "export function lazily(): Promise<unknown> { return import('./lazy.ts'); }",
    ].join('\n'),
  );

  assert.deepEqual(read, {
    imports: ['./here.ts', './beside.ts', './lazy.ts'],
    addresses: [
      { place: 'probe.ts:5 import.meta.url', atLoad: true },
      { place: 'probe.ts:6 import.meta.resolve', atLoad: false },
      { place: 'probe.ts:7 import.meta.filename', atLoad: true },
    ],
  });
});
