import type { CheckAnswer, CheckJob, StrippedSources } from '@on.auto/workflow-engine/dsl';
import { Function } from 'effect';
import ts from 'typescript6';

import { locatedIn } from './diagnostics.ts';
import { expressionIssues } from './expression-issues.ts';
import { expressionsFileOf } from './expressions-file.ts';
import { checkedModuleOf, moduleFiles, moduleIssues, sourceFileOf, type CheckedModule } from './module-check.ts';
import type { SandboxLib } from './sandbox-lib.ts';
import { declarationsOf } from './schema-types.ts';
import { strippedExpression, strippedModule } from './type-stripping.ts';

export type Check = (job: CheckJob) => CheckAnswer;

const checkedFiles = {
  lib: '/sandbox.d.ts',
  iterator: '/sandbox-iterator.d.ts',
  declarations: '/declarations.d.ts',
  expressions: '/expressions.ts',
};

const options: ts.CompilerOptions = {
  strict: true,
  exactOptionalPropertyTypes: true,
  isolatedModules: true,
  erasableSyntaxOnly: true,
  allowImportingTsExtensions: true,
  noEmit: true,
  noLib: true,
  types: [],
  target: ts.ScriptTarget.ES2025,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  moduleDetection: ts.ModuleDetectionKind.Force,
};

function hostOf(files: () => ReadonlyMap<string, ts.SourceFile>): ts.CompilerHost {
  const known = files();
  return {
    getSourceFile: known.get.bind(known),
    getDefaultLibFileName: () => checkedFiles.lib,
    writeFile: Function.constVoid,
    getCurrentDirectory: () => '/',
    getCanonicalFileName: Function.identity,
    useCaseSensitiveFileNames: () => true,
    getNewLine: Function.constant('\n'),
    fileExists: known.has.bind(known),
    readFile: Function.constUndefined,
  };
}

function strippedSourcesOf(job: CheckJob, checked: CheckedModule | undefined): StrippedSources {
  const expressions = job.expressions.map(({ source }) => strippedExpression(source));
  return checked === undefined ? { expressions } : { module: strippedModule(checked.file), expressions };
}

function filesOf(lib: SandboxLib): (job: CheckJob, checked: CheckedModule | undefined) => Map<string, ts.SourceFile> {
  const script = sourceFileOf(checkedFiles.lib, lib.script);
  const iterator = sourceFileOf(checkedFiles.iterator, lib.iterator);
  return (job, checked) => {
    const files = new Map([
      [checkedFiles.lib, script],
      [checkedFiles.iterator, iterator],
      [checkedFiles.declarations, sourceFileOf(checkedFiles.declarations, declarationsOf(job))],
    ]);
    if (checked !== undefined) {
      files.set(moduleFiles.program, checked.file());
      files.set(moduleFiles.contract, checked.contractFile());
    }
    return files;
  };
}

export function checkerOf(lib: SandboxLib): Check {
  const filesFor = filesOf(lib);
  return (job) => {
    const placed = expressionsFileOf(job.expressions);
    const expressions = sourceFileOf(checkedFiles.expressions, placed.text);
    const checked = checkedModuleOf(job);
    const files = filesFor(job, checked);
    files.set(checkedFiles.expressions, expressions);
    const program = ts.createProgram(
      [...files.keys()],
      options,
      hostOf(() => files),
    );
    const expressionsFile = () => expressions;
    const issues = [
      ...(checked === undefined ? [] : moduleIssues(program, checked)),
      ...expressionIssues(expressionsFile, placed, {
        syntactic: locatedIn(expressionsFile, () => program.getSyntacticDiagnostics(expressions)),
        semantic: () => locatedIn(expressionsFile, () => program.getSemanticDiagnostics(expressions)),
      }),
    ];
    return issues.length === 0
      ? { ran: 'checked', issues, stripped: strippedSourcesOf(job, checked) }
      : { ran: 'checked', issues };
  };
}
