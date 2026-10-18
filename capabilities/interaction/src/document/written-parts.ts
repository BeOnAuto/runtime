import {
  issueAt,
  type DocumentIssue,
  type DocumentParts,
  type SourceLines,
  type ValueContract,
} from '@on.auto/definitions/document';
import type { ParsedTemplate } from '@on.auto/definitions/template';
import { compileJsonSchema } from '@on.auto/json-schema';
import { mostValueDepth } from '@on.auto/workflow-engine/dsl';
import { Result, type Schema } from 'effect';

import { expiryOf } from './expiry.ts';
import { compiledTemplate } from './request-templates.ts';

export type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

export function issuesOf(check: () => Checked<unknown>): readonly DocumentIssue[] {
  const checked = check();
  return Result.isFailure(checked) ? checked.failure : [];
}

type ValueSection = { readonly schema?: Schema.JsonObject } | undefined;

export function messageOf({ body, bodyLine }: DocumentParts, inputSchema?: Schema.JsonObject): Checked<ParsedTemplate> {
  if (body.trim() === '') {
    return Result.fail([
      { line: bodyLine, pointer: '', detail: 'The definition has no message: write it after the front matter' },
    ]);
  }
  return compiledTemplate(body, { line: bodyLine, pointer: '', what: 'the message of a request' }, inputSchema);
}

export function contractOf(
  section: ValueSection,
  name: 'input' | 'output',
  lines: SourceLines,
): Checked<ValueContract> {
  const document = section?.schema;
  if (document === undefined) {
    return Result.succeed({});
  }
  return Result.mapBoth(compileJsonSchema(document, { what: name, nesting: mostValueDepth }), {
    onSuccess: (schema) => ({ schema }),
    onFailure: (issues) => issues.map(({ pointer, detail }) => issueAt(lines, `/${name}/schema${pointer}`, detail)),
  });
}

export function expiresOf(written: string, lines: SourceLines): Checked<number> {
  return Result.mapError(expiryOf(written), (detail) => [issueAt(lines, '/expires', detail)]);
}

export function toOf(written: string, lines: SourceLines, inputSchema: Schema.JsonObject | undefined) {
  const line = issueAt(lines, '/to', '').line;
  return compiledTemplate(written, { line, pointer: '/to', what: 'the party of a request' }, inputSchema);
}
