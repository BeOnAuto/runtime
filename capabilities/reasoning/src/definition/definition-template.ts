import type { DocumentIssue, DocumentParts } from '@on.auto/definitions/document';
import { Result } from 'effect';

import type { CompiledTemplate } from '../template/compiled-template.ts';
import { compileTemplate } from '../template/template-compilation.ts';

const noMessage = 'The template writes no message: write it after the front matter, outside the {% system %} block';

export function templateOf({
  body,
  bodyLine,
}: DocumentParts): Result.Result<CompiledTemplate, readonly DocumentIssue[]> {
  const compiled = Result.mapError(compileTemplate(body, bodyLine), (issues) =>
    issues.map(({ line, detail }) => ({ line, pointer: '', detail })),
  );
  return Result.flatMap(compiled, (template) =>
    template.hasMessage ? Result.succeed(template) : Result.fail([{ line: bodyLine, pointer: '', detail: noMessage }]),
  );
}
