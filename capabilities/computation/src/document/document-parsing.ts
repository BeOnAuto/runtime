import { declaredShape, type OutputShape } from '@on.auto/definitions';
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
import { oneLanguage } from '@on.auto/workflow-engine';
import { mostValueDepth } from '@on.auto/workflow-engine/dsl';
import { Result, type Schema } from 'effect';

import type { ComputationFunctionDefinitionDocument, OutputContract } from './computation-document.ts';
import { computationFrontMatter, decodeFrontMatter, type OutputSection } from './front-matter.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

interface ProgramPart {
  readonly program: string;
  readonly programLine: number;
}

type ValueSection = { readonly schema?: Schema.JsonObject } | undefined;

const language = 'typescript';

function issuesOf(check: () => Checked<unknown>): readonly DocumentIssue[] {
  const checked = check();
  return Result.isFailure(checked) ? checked.failure : [];
}

function programOf({ body, bodyLine }: DocumentParts): Checked<ProgramPart> {
  if (body.trim() === '') {
    return Result.fail([
      { line: bodyLine, pointer: '', detail: 'The definition has no program: write it after the front matter' },
    ]);
  }
  return Result.succeed({ program: body, programLine: bodyLine });
}

function languageOf(written: string, lines: SourceLines): Checked<typeof language> {
  return written === language ? Result.succeed(language) : Result.fail([issueAt(lines, '/language', oneLanguage)]);
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

function shapedContractOf(shape: OutputShape): OutputContract {
  const { schema, further } = shape;
  return {
    schema: Result.getOrThrow(compileJsonSchema(schema, { what: 'output', nesting: mostValueDepth, further })),
    shape,
  };
}

function outputContractOf(section: OutputSection, lines: SourceLines): Checked<OutputContract> {
  if (section?.shape === undefined) {
    return contractOf(section, 'output', lines);
  }
  return declaredShape(section.shape, section.schema !== undefined).pipe(
    Result.mapBoth({
      onFailure: ({ at, detail }) => [issueAt(lines, `/output/${at}`, detail)],
      onSuccess: shapedContractOf,
    }),
  );
}

function documentFrom(
  { root, lines, issues }: ReadFrontMatter,
  program: () => Checked<ProgramPart>,
): Checked<ComputationFunctionDefinitionDocument> {
  const decoded = decodeFrontMatter(root);
  if (issues.length > 0 || Result.isFailure(decoded)) {
    return Result.fail([...issues, ...issuesOf(program)]);
  }
  const { description, input, output } = decoded.success;
  const parts = {
    language: languageOf(decoded.success.language, lines),
    input: contractOf(input, 'input', lines),
    output: outputContractOf(output, lines),
    program: program(),
  };
  const found = [
    ...issuesOf(() => parts.language),
    ...issuesOf(() => parts.input),
    ...issuesOf(() => parts.output),
    ...issuesOf(() => parts.program),
  ];
  return found.length > 0
    ? Result.fail(found)
    : Result.map(Result.all(parts), (checked) => ({
        ...(description === undefined ? {} : { description }),
        language: checked.language,
        input: checked.input,
        output: checked.output,
        ...checked.program,
      }));
}

function documentOf(parts: DocumentParts): Checked<ComputationFunctionDefinitionDocument> {
  const program = programOf(parts);
  const reading = frontMatterIn(parts.frontMatter, parts.frontMatterLine, computationFrontMatter);
  return Result.isFailure(reading)
    ? Result.fail([...reading.failure, ...issuesOf(() => program)])
    : documentFrom(reading.success, () => program);
}

export function parseComputationDocument(source: string): Checked<ComputationFunctionDefinitionDocument> {
  return Result.mapError(
    Result.flatMap(splitDocument(source, 'A computation function definition'), documentOf),
    reportedIssues,
  );
}
