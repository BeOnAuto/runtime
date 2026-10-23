import type { CheckIssue, CheckJob } from '@on.auto/workflow-engine/dsl';
import ts from 'typescript6';

import { assignmentIssues } from './assignment-count.ts';
import { locatedIn, type Located } from './diagnostics.ts';
import { contractOf, contractIssues, type Contract } from './entry-contracts.ts';
import { exportedFunctions, moduleRuleIssues, type Place } from './module-rules.ts';

export interface CheckedModule {
  readonly place: Place;
  readonly file: () => ts.SourceFile;
  readonly contract: Contract;
  readonly contractFile: () => ts.SourceFile;
}

export const moduleFiles = { program: '/program.ts', contract: '/contract.ts' };

export function sourceFileOf(name: string, text: string): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.ES2025, true);
}

function analysedIssues(
  program: ts.Program,
  { file, place, contract, contractFile }: CheckedModule,
): readonly Located[] {
  const compiled = locatedIn(file, () => [
    ...program.getSyntacticDiagnostics(file()),
    ...program.getSemanticDiagnostics(file()),
  ]);
  const contracted = contractIssues(
    locatedIn(contractFile, () => program.getSemanticDiagnostics(contractFile())),
    contract,
  );
  return [...compiled, ...moduleRuleIssues(file, place), ...contracted];
}

export function moduleIssues(program: ts.Program, checked: CheckedModule): readonly CheckIssue[] {
  const bounded = assignmentIssues(checked.file);
  const located =
    bounded.length > 0
      ? [...bounded, ...moduleRuleIssues(checked.file, checked.place)]
      : analysedIssues(program, checked);
  return located.map(({ line, detail }): CheckIssue => ({ at: 'module', line, detail }));
}

export function checkedModuleOf(job: CheckJob): CheckedModule | undefined {
  if (job.module === undefined) {
    return undefined;
  }
  const file = sourceFileOf(moduleFiles.program, job.module.source);
  const contract = contractOf(
    exportedFunctions(() => file),
    job.module.place,
  );
  const contractFile = sourceFileOf(moduleFiles.contract, contract.text);
  return { place: job.module.place, file: () => file, contract, contractFile: () => contractFile };
}
