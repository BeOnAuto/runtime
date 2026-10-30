import ts from 'typescript6';

import type { Located } from './diagnostics.ts';

export type Place = 'computation' | 'recall';

export type EntryName = 'default' | 'fold' | 'answer';

export interface Entry {
  readonly name: EntryName;
  readonly contract: string;
  readonly required: boolean;
}

export interface ExportedFunction {
  readonly name: string | undefined;
  readonly line: number;
  readonly generator: boolean;
}

export const readsNothing = 'A program reads nothing but its arguments: it imports no module and builds no code';

export const holdsNothing =
  'A module holds its types and its exported functions and nothing else, so that two calls share nothing';

export const answersAtOnce = 'The program is a function that answers at once; it awaits nothing';

export const placeEntries: Readonly<Record<Place, readonly Entry[]>> = {
  computation: [{ name: 'default', contract: '(input: Input) => Output', required: true }],
  recall: [
    { name: 'fold', contract: '(view: View, event: Event) => View', required: true },
    { name: 'answer', contract: '(view: View, input: Input) => Output', required: false },
  ],
};

export const signatures: Readonly<Record<EntryName, string>> = {
  default: 'The program is a module whose default export is a function (input: Input): Output',
  fold: 'The program is a module that exports a function fold(view: View, event: Event): View',
  answer: 'The program exports answer as a function answer(view: View, input: Input): Output',
};

function lineOf(node: ts.Node): number {
  const file = node.getSourceFile();
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false);
}

function exportedOf(statement: ts.Node): ExportedFunction | undefined {
  if (!ts.isFunctionDeclaration(statement) || !hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
    return undefined;
  }
  return {
    name: hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ? 'default' : statement.name?.text,
    line: lineOf(statement),
    generator: statement.asteriskToken !== undefined,
  };
}

function readsOutside(node: ts.Node): boolean {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    return (
      callee.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(callee) && ['require', 'eval', 'Function'].includes(callee.text))
    );
  }
  if (ts.isNewExpression(node)) {
    return ts.isIdentifier(node.expression) && node.expression.text === 'Function';
  }
  return ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword;
}

function awaits(node: ts.Node): boolean {
  return ts.isAwaitExpression(node) || hasModifier(node, ts.SyntaxKind.AsyncKeyword);
}

function bodyIssues(root: ts.Node): readonly Located[] {
  const found: Located[] = [];
  const visit = (node: ts.Node): void => {
    if (readsOutside(node)) {
      found.push({ line: lineOf(node), detail: readsNothing });
    } else if (awaits(node)) {
      found.push({ line: lineOf(node), detail: answersAtOnce });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
  return found;
}

function readsFromOutside(statement: ts.Node): boolean {
  return (
    ts.isImportDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement) ||
    (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) ||
    hasModifier(statement, ts.SyntaxKind.DeclareKeyword)
  );
}

function statementIssue(statement: ts.Node): Located | undefined {
  if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
    return undefined;
  }
  const line = lineOf(statement);
  if (readsFromOutside(statement)) {
    return { line, detail: readsNothing };
  }
  const exported = exportedOf(statement);
  if (exported === undefined) {
    return { line, detail: holdsNothing };
  }
  return exported.generator ? { line, detail: answersAtOnce } : undefined;
}

export function exportedFunctions(file: () => ts.SourceFile): readonly ExportedFunction[] {
  const exported: ExportedFunction[] = [];
  for (const statement of file().statements) {
    const found = exportedOf(statement);
    if (found !== undefined) {
      exported.push(found);
    }
  }
  return exported;
}

function exportIssues(exported: readonly ExportedFunction[], place: Place): readonly Located[] {
  return placeEntries[place]
    .filter(({ name, required }) => required && !exported.some((declared) => declared.name === name))
    .map(({ name }) => ({ line: 1, detail: signatures[name] }));
}

export function moduleRuleIssues(file: () => ts.SourceFile, place: Place): readonly Located[] {
  const issues: Located[] = [];
  for (const statement of file().statements) {
    const issue = statementIssue(statement);
    if (issue !== undefined) {
      issues.push(issue);
    }
  }
  return [...issues, ...bodyIssues(file()), ...exportIssues(exportedFunctions(file), place)];
}
