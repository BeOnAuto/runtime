import tsBlankSpace, { blankSourceFile } from 'ts-blank-space';
import type ts from 'typescript6';

export function strippedModule(file: () => ts.SourceFile): string {
  return blankSourceFile(file());
}

export function strippedExpression(body: string): string {
  return tsBlankSpace(`(\n${body}\n)`).slice(2, -2);
}
