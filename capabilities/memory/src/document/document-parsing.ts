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
import { compileJsonSchema } from '@on.auto/json-schema';
import { mostValueDepth } from '@on.auto/workflow-engine/dsl';
import { Result, type Schema } from 'effect';

import { recallBlockOf, rememberBlockOf } from './block-parts.ts';
import { decodeFrontMatter, memoryFrontMatter, type MemoryFrontMatter } from './front-matter.ts';
import type { MemoryBlock, MemoryFunctionDefinitionDocument } from './memory-document.ts';
import { issuesAcross, type Checked, type WrittenPlace } from './written-fields.ts';

const takesNoBody =
  'A memory function takes no body: write what it remembers or recalls in its front matter, under remember or recall';

const bothBlocks = 'A memory function remembers or recalls, so it takes remember or recall, not both';

const neitherBlock = 'A memory function takes remember, to write what it remembers, or recall, to say what it recalls';

function bodyIssues({ body, bodyLine }: DocumentParts): readonly DocumentIssue[] {
  return body.trim() === '' ? [] : [{ line: bodyLine, pointer: '', detail: takesNoBody }];
}

function contractOf(schema: Schema.JsonObject | undefined, lines: SourceLines): Checked<ValueContract> {
  if (schema === undefined) {
    return Result.succeed({});
  }
  return Result.mapBoth(compileJsonSchema(schema, { what: 'input', nesting: mostValueDepth }), {
    onSuccess: (compiled) => ({ schema: compiled }),
    onFailure: (issues) => issues.map(({ pointer, detail }) => issueAt(lines, `/input/schema${pointer}`, detail)),
  });
}

function blockOf({ remember, recall }: MemoryFrontMatter, place: WrittenPlace): Checked<MemoryBlock> {
  if (remember !== undefined && recall !== undefined) {
    return Result.fail([issueAt(place.lines, '/recall', bothBlocks)]);
  }
  if (remember !== undefined) {
    return Result.map(rememberBlockOf(remember, place), (block): MemoryBlock => ({
      kind: 'remember',
      remember: block,
    }));
  }
  return recall === undefined
    ? Result.fail([issueAt(place.lines, '', neitherBlock)])
    : Result.map(recallBlockOf(recall, place), (block): MemoryBlock => ({ kind: 'recall', recall: block }));
}

function documentFrom(
  { root, lines, issues }: ReadFrontMatter,
  body: readonly DocumentIssue[],
  organizationKept: boolean,
): Checked<MemoryFunctionDefinitionDocument> {
  const decoded = decodeFrontMatter(root);
  if (issues.length > 0 || Result.isFailure(decoded)) {
    return Result.fail([...issues, ...body]);
  }
  const { description, input: written } = decoded.success;
  const inputSchema = written?.schema;
  const input = contractOf(inputSchema, lines);
  const block = blockOf(decoded.success, { lines, inputSchema, organizationKept });
  const found = [...body, ...issuesAcross([() => input, () => block])];
  if (found.length > 0) {
    return Result.fail(found);
  }
  return Result.map(Result.all({ input, block }), (parts) => ({
    ...(description === undefined ? {} : { description }),
    ...parts,
  }));
}

function documentOf(parts: DocumentParts, organizationKept: boolean): Checked<MemoryFunctionDefinitionDocument> {
  const body = bodyIssues(parts);
  const reading = frontMatterIn(parts.frontMatter, parts.frontMatterLine, memoryFrontMatter);
  return Result.isFailure(reading)
    ? Result.fail([...reading.failure, ...body])
    : documentFrom(reading.success, body, organizationKept);
}

export function parseMemoryDocument(
  source: string,
  organizationKept = true,
): Checked<MemoryFunctionDefinitionDocument> {
  return Result.mapError(
    Result.flatMap(splitDocument(source, 'A memory function definition'), (parts) =>
      documentOf(parts, organizationKept),
    ),
    (issues) => reportedIssues(issues),
  );
}
