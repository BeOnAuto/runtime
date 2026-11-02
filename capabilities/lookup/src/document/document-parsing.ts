import {
  frontMatterIn,
  issueAt,
  reportedIssues,
  splitDocument,
  type DocumentIssue,
  type DocumentParts,
  type ReadFrontMatter,
  type SourceLines,
  type ValueContract,
} from '@on.auto/definitions/document';
import type { RenderClock } from '@on.auto/definitions/template';
import { compiledCallBlock } from '@on.auto/definitions/tool-blocks';
import { compileJsonSchema } from '@on.auto/json-schema';
import { mostValueDepth } from '@on.auto/workflow-engine/dsl';
import { Result, type Schema } from 'effect';

import { decodeFrontMatter, lookupFrontMatter } from './front-matter.ts';
import type { LookupFunctionDefinitionDocument } from './lookup-document.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

type ValueSection = { readonly schema?: Schema.JsonObject } | undefined;

const noBody =
  'A lookup function sends no message and asks no model: leave the body after the front matter empty, and say what the function does in description';

const outputNeeded = 'A lookup function answers with what its tool answered, so output.schema says what that is';

function issuesOf(check: () => Checked<unknown>): readonly DocumentIssue[] {
  const checked = check();
  return Result.isFailure(checked) ? checked.failure : [];
}

function bodyIssues({ body, bodyLine }: DocumentParts): readonly DocumentIssue[] {
  const firstWritten = body.split('\n').findIndex((line) => line.trim() !== '');
  return firstWritten === -1 ? [] : [{ line: bodyLine + firstWritten, pointer: '', detail: noBody }];
}

function contractOf(section: ValueSection, name: 'input' | 'output', lines: SourceLines): Checked<ValueContract> {
  const document = section?.schema;
  if (document === undefined) {
    return Result.succeed({});
  }
  return Result.mapBoth(compileJsonSchema(document, { what: name, nesting: mostValueDepth }), {
    onSuccess: (schema) => ({ schema }),
    onFailure: (issues) => issues.map(({ pointer, detail }) => issueAt(lines, `/${name}/schema${pointer}`, detail)),
  });
}

function answeredOf(section: ValueSection, lines: SourceLines): Checked<LookupFunctionDefinitionDocument['output']> {
  return Result.flatMap(contractOf(section, 'output', lines), ({ schema }) =>
    schema === undefined ? Result.fail([issueAt(lines, '/call', outputNeeded)]) : Result.succeed({ schema }),
  );
}

function documentFrom(
  { root, lines, issues }: ReadFrontMatter,
  parts: DocumentParts,
  clock: RenderClock,
): Checked<LookupFunctionDefinitionDocument> {
  const decoded = decodeFrontMatter(root);
  if (issues.length > 0 || Result.isFailure(decoded)) {
    return Result.fail([...issues, ...bodyIssues(parts)]);
  }
  const { description, call } = decoded.success;
  const input = contractOf(decoded.success.input, 'input', lines);
  const output = answeredOf(decoded.success.output, lines);
  const inputSchema = Result.isSuccess(input) ? input.success.schema?.document : undefined;
  const found = [
    ...bodyIssues(parts),
    ...issuesOf(() => compiledCallBlock(call, { lines, clock }, inputSchema)),
    ...issuesOf(() => input),
    ...issuesOf(() => output),
  ];
  return found.length > 0
    ? Result.fail(found)
    : Result.map(Result.all({ input, output }), (contracts) => ({
        ...(description === undefined ? {} : { description }),
        call,
        callLine: issueAt(lines, '/call', '').line,
        ...contracts,
      }));
}

function documentOf(parts: DocumentParts, clock: RenderClock): Checked<LookupFunctionDefinitionDocument> {
  const reading = frontMatterIn(parts.frontMatter, parts.frontMatterLine, lookupFrontMatter);
  return Result.isFailure(reading)
    ? Result.fail([...reading.failure, ...bodyIssues(parts)])
    : documentFrom(reading.success, parts, clock);
}

export function parseLookupDocument(source: string, clock: RenderClock): Checked<LookupFunctionDefinitionDocument> {
  return Result.mapError(
    Result.flatMap(splitDocument(source, 'A lookup function definition'), (parts) => documentOf(parts, clock)),
    reportedIssues,
  );
}
