import { shippedFileIn, type ShippedFile, type ShippedFiles, type ShippedRoots } from '@on.auto/operations';
import { sandboxRemovals } from '@on.auto/workflow-engine/worker';
import ts from 'typescript6';

import { instanceSamples } from './instance-samples.ts';

export interface SandboxLib {
  readonly script: string;
  readonly iterator: string;
}

export type Probe = (expressions: readonly string[]) => Promise<readonly string[]>;

interface Removal {
  readonly start: number;
  readonly end: number;
}

interface Probed {
  readonly removal: Removal;
  readonly expression: string;
}

interface Candidates {
  readonly removed: readonly Removal[];
  readonly probed: readonly Probed[];
}

interface PrintedLib {
  readonly name: string;
  readonly text: string;
}

interface LibFile {
  readonly name: string;
  readonly text: string;
  readonly candidates: Candidates;
}

const compilerPackage = 'typescript6';

export const compilerShippedRoots: ShippedRoots = {
  [compilerPackage]: new URL('.', import.meta.resolve(`${compilerPackage}/package.json`)),
};

const compilerLib: ShippedFile = { package: compilerPackage, path: 'lib' };

const skipped = /intl|weakref/u;

const notices = /^\/\*![\s\S]*?\*\/\n/gmu;

const libReferences = /^\/\/\/ <reference lib="[^"]+" \/>\n/gmu;

const iteratorLib = 'lib.es2025.iterator.d.ts';

async function libSource(shippedFiles: ShippedFiles, name: string): Promise<ts.SourceFile> {
  const fileName = `lib.${name}.d.ts`;
  const text = await shippedFiles.text(shippedFileIn(compilerLib, fileName));
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2025, true);
}

async function libsFrom(
  shippedFiles: ShippedFiles,
  name: string,
  seen: Set<string>,
): Promise<readonly ts.SourceFile[]> {
  if (seen.has(name) || skipped.test(name)) {
    return [];
  }
  seen.add(name);
  const source = await libSource(shippedFiles, name);
  const referenced = await source.libReferenceDirectives.reduce<Promise<readonly ts.SourceFile[]>>(
    async (before, { fileName }: Readonly<ts.FileReference>) => [
      ...(await before),
      ...(await libsFrom(shippedFiles, fileName, seen)),
    ],
    Promise.resolve([]),
  );
  return [...referenced, source];
}

function removalOf(node: ts.Node): Removal {
  return { start: node.getFullStart(), end: node.getEnd() };
}

function nameOf(name: ts.Node | undefined): string | undefined {
  if (name === undefined) {
    return undefined;
  }
  if (ts.isComputedPropertyName(name)) {
    return `[${name.expression.getText()}]`;
  }
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

function declaredValuesOf(statement: ts.Node): readonly (readonly [string, string])[] {
  const found: (readonly [string, string])[] = [];
  const declarations = ts.isVariableStatement(statement) ? statement.declarationList.declarations : [];
  for (const { name, type } of declarations) {
    if (type !== undefined && ts.isTypeReferenceNode(type)) {
      found.push([type.typeName.getText(), name.getText()]);
    }
  }
  return found;
}

function holdersOf(sources: () => readonly ts.SourceFile[]): ReadonlyMap<string, string> {
  const holders = new Map<string, string>(Object.entries(instanceSamples));
  for (const source of sources()) {
    for (const statement of source.statements) {
      for (const [type, value] of declaredValuesOf(statement)) {
        holders.set(type, value);
      }
    }
  }
  return holders;
}

function probeOf(holder: string, name: string): string {
  const key = name.startsWith('[') ? name.slice(1, -1) : JSON.stringify(name);
  return `(() => { const held = Object(${holder}); try { return Reflect.get(held, ${key}) !== undefined || Reflect.has(held, ${key}) } catch { return false } })()`;
}

function removedByThePrelude(holder: string, name: string | undefined): boolean {
  if (holder === 'Math') {
    return sandboxRemovals.mathMembers.includes(String(name));
  }
  return (
    holder === 'Date' && [...sandboxRemovals.dateMethods, ...sandboxRemovals.dateTextMethods].includes(String(name))
  );
}

function readsLocalTime(holder: string, member: ts.Node): boolean {
  const { called, mostArguments } = sandboxRemovals.dateConstructor;
  return (
    holder === 'DateConstructor' &&
    ((!called && ts.isCallSignatureDeclaration(member)) ||
      (ts.isConstructSignatureDeclaration(member) && member.parameters.length > mostArguments))
  );
}

function globalNameOf(statement: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(statement)) {
    return statement.name?.text;
  }
  return ts.isVariableStatement(statement) ? nameOf(statement.declarationList.declarations[0]?.name) : undefined;
}

function intlValues(statement: ts.Node): readonly Removal[] {
  const body = ts.isModuleDeclaration(statement) && statement.name.getText() === 'Intl' ? statement.body : undefined;
  const removed: Removal[] = [];
  for (const inner of body !== undefined && ts.isModuleBlock(body) ? body.statements : []) {
    if (ts.isVariableStatement(inner) || ts.isFunctionDeclaration(inner)) {
      removed.push(removalOf(inner));
    }
  }
  return removed;
}

function globalCandidates(statement: ts.Node): Candidates {
  const global = globalNameOf(statement);
  if (global === undefined) {
    return { removed: intlValues(statement), probed: [] };
  }
  return sandboxRemovals.globals.includes(global)
    ? { removed: [removalOf(statement)], probed: [] }
    : { removed: [], probed: [{ removal: removalOf(statement), expression: `typeof ${global} !== "undefined"` }] };
}

function memberCandidates(statement: ts.Node, holders: ReadonlyMap<string, string>): Candidates {
  const removed: Removal[] = [];
  const probed: Probed[] = [];
  const holder = ts.isInterfaceDeclaration(statement) ? statement.name.text : '';
  const instance = holders.get(holder);
  for (const member of ts.isInterfaceDeclaration(statement) ? statement.members : []) {
    const name = nameOf(member.name);
    if (readsLocalTime(holder, member) || removedByThePrelude(holder, name)) {
      removed.push(removalOf(member));
    } else if (name !== undefined && instance !== undefined) {
      probed.push({ removal: removalOf(member), expression: probeOf(instance, name) });
    }
  }
  return { removed, probed };
}

function candidatesIn(source: () => ts.SourceFile, holders: ReadonlyMap<string, string>): Candidates {
  const removed: Removal[] = [];
  const probed: Probed[] = [];
  for (const statement of source().statements) {
    for (const found of [globalCandidates(statement), memberCandidates(statement, holders)]) {
      removed.push(...found.removed);
      probed.push(...found.probed);
    }
  }
  return { removed, probed };
}

function spliced(text: string, removals: readonly Removal[]): string {
  return removals
    .toSorted((first, second) => second.start - first.start)
    .reduce((kept, { start, end }) => `${kept.slice(0, start)}${kept.slice(end)}`, text);
}

function printed(name: string, text: string): string {
  const printer = ts.createPrinter({ removeComments: true });
  return printer
    .printFile(ts.createSourceFile(name, text, ts.ScriptTarget.ES2025, false))
    .replaceAll(libReferences, '');
}

function withOneNotice(text: string): string {
  let seen = false;
  return text.replaceAll(notices, (notice) => {
    const kept = seen ? '' : notice;
    seen = true;
    return kept;
  });
}

function libFilesOf(sources: () => readonly ts.SourceFile[]): readonly LibFile[] {
  const holders = holdersOf(sources);
  const files: LibFile[] = [];
  for (const source of sources()) {
    files.push({ name: source.fileName, text: source.text, candidates: candidatesIn(() => source, holders) });
  }
  return files;
}

export async function sandboxLibOf(shippedFiles: ShippedFiles, probe: Probe): Promise<SandboxLib> {
  const sources = await libsFrom(shippedFiles, 'es2025', new Set());
  const files = libFilesOf(() => sources);
  const answers = await probe(files.flatMap(({ candidates }) => candidates.probed.map(({ expression }) => expression)));
  let answered = 0;
  const texts = files.map(({ name, text, candidates }): PrintedLib => {
    const missing = candidates.probed.filter((_, at) => answers[answered + at] !== 'true');
    answered += candidates.probed.length;
    return {
      name,
      text: printed(name, spliced(text, [...candidates.removed, ...missing.map(({ removal }) => removal)])),
    };
  });
  const joined = (iterator: boolean) =>
    withOneNotice(
      texts
        .filter(({ name }) => (name === iteratorLib) === iterator)
        .map(({ text }) => text)
        .join('\n'),
    );
  return { script: joined(false), iterator: joined(true) };
}
