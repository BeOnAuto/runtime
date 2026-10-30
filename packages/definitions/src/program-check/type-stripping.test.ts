import ts from 'typescript6';
import { describe, expect, it } from 'vitest';

import { strippedExpression, strippedModule } from './type-stripping.ts';

function fileOf(source: string): ts.SourceFile {
  return ts.createSourceFile('/program.ts', source, ts.ScriptTarget.ES2025, true);
}

describe('stripping the types of a program the check passed', () => {
  it('blanks its types where they stood, so every line and column stays where it was written', () => {
    const source =
      'type Reply = { text: string };\nexport function answer(input: Reply): string {\n  return input.text as string;\n}';

    const javascript = strippedModule(() => fileOf(source));

    expect(javascript).toBe(
      '                              \nexport function answer(input       )         {\n  return input.text          ;\n}',
    );
    expect(javascript.split('\n').map((line) => line.length)).toEqual(source.split('\n').map((line) => line.length));
  });

  it('strips the body of an expression alone, keeping its lines', () => {
    expect(strippedExpression('$data.total as number')).toBe('$data.total          ');
    expect(strippedExpression('[\n  $data.total as number,\n]')).toBe('[\n  $data.total          ,\n]');
    expect(strippedExpression(' $data.total ')).toBe(' $data.total ');
  });
});
