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
import { compiledCallBlock, type CallBlock } from '@on.auto/definitions/tool-blocks';
import { compileJsonSchema } from '@on.auto/json-schema';
import { mostValueDepth } from '@on.auto/workflow-engine/dsl';
import { Result, type Schema } from 'effect';

import { decodeFrontMatter, lookupFrontMatter, type LookupFrontMatter, type WrittenRuns } from './front-matter.ts';
import type { CallLookupDocument, LookupFunctionDefinitionDocument, RunsLookupDocument } from './lookup-document.ts';
import { runsBlockOf, type WrittenPlace } from './runs-block.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

type ValueSection = { readonly schema?: Schema.JsonObject } | undefined;

type Reading =
  | Pick<CallLookupDocument, 'kind' | 'call' | 'callLine' | 'output'>
  | Pick<RunsLookupDocument, 'kind' | 'runs'>;

const noBody =
  'A lookup function sends no message and asks no model: leave the body after the front matter empty, and say what the function does in description';

const outputNeeded = 'A lookup function answers with what its tool answered, so output.schema says what that is';

const bothReadings =
  'A lookup function reads through one tool or from the runs of one definition, so it takes call or runs, not both';

const neitherReading =
  'A lookup function takes call, to read through one tool, or runs, to read the outputs of the runs of a definition of this playbook';

const noOutputSchema =
  'A lookup function that reads runs answers with their outputs in a shape of its own, so it takes no output.schema';

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

function answeredOf(section: ValueSection, lines: SourceLines): Checked<CallLookupDocument['output']> {
  return Result.flatMap(contractOf(section, 'output', lines), ({ schema }) =>
    schema === undefined ? Result.fail([issueAt(lines, '/call', outputNeeded)]) : Result.succeed({ schema }),
  );
}

function callReadingOf(call: CallBlock, output: ValueSection, place: WrittenPlace): Checked<Reading> {
  const { lines, clock, inputSchema } = place;
  const compiled = compiledCallBlock(call, { lines, clock }, inputSchema);
  const answered = answeredOf(output, lines);
  const issues = [...issuesOf(() => compiled), ...issuesOf(() => answered)];
  return issues.length > 0
    ? Result.fail(issues)
    : Result.map(answered, (answer): Reading => ({
        kind: 'call',
        call,
        callLine: issueAt(lines, '/call', '').line,
        output: answer,
      }));
}

function runsReadingOf(runs: WrittenRuns, output: ValueSection, place: WrittenPlace): Checked<Reading> {
  const block = runsBlockOf(runs, place);
  const declared = output?.schema === undefined ? [] : [issueAt(place.lines, '/output/schema', noOutputSchema)];
  const issues = [...issuesOf(() => block), ...declared];
  return issues.length > 0 ? Result.fail(issues) : Result.map(block, (read): Reading => ({ kind: 'runs', runs: read }));
}

function readingOf({ call, runs, output }: LookupFrontMatter, place: WrittenPlace): Checked<Reading> {
  if (call !== undefined && runs !== undefined) {
    return Result.fail([issueAt(place.lines, '/runs', bothReadings)]);
  }
  if (call !== undefined) {
    return callReadingOf(call, output, place);
  }
  return runs === undefined
    ? Result.fail([issueAt(place.lines, '', neitherReading)])
    : runsReadingOf(runs, output, place);
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
  const { description } = decoded.success;
  const input = contractOf(decoded.success.input, 'input', lines);
  const inputSchema = Result.isSuccess(input) ? input.success.schema?.document : undefined;
  const reading = readingOf(decoded.success, { lines, clock, inputSchema });
  const found = [...bodyIssues(parts), ...issuesOf(() => reading), ...issuesOf(() => input)];
  return found.length > 0
    ? Result.fail(found)
    : Result.map(Result.all({ input, reading }), (read) => ({
        ...(description === undefined ? {} : { description }),
        input: read.input,
        ...read.reading,
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
