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
import { compileJsonSchema, type CompiledSchema } from '@on.auto/json-schema';
import { oneLanguage } from '@on.auto/workflow-engine';
import { enclosedBody, jsonBytesOf, mostValueDepth } from '@on.auto/workflow-engine/dsl';
import type { ViewFilter } from '@on.auto/workflow-host';
import { Result, type Schema } from 'effect';

import { recallBounds } from '../run/recall-bounds.ts';
import { decodeFrontMatter, recallFrontMatter, type RecallFrontMatter } from './front-matter.ts';
import type { FilterExpression, RecallFunctionDefinitionDocument } from './recall-document.ts';
import { filtersOf } from './source-filters.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

interface FoldPart {
  readonly fold: string;
  readonly foldLine: number;
}

interface ViewPart {
  readonly initial: Schema.Json;
  readonly schema?: CompiledSchema;
}

type ValueSection = { readonly schema?: Schema.JsonObject } | undefined;

const language = 'typescript';

const exportedAnswer = /^export function answer\b/mu;

function issuesOf(check: () => Checked<unknown>): readonly DocumentIssue[] {
  const checked = check();
  return Result.isFailure(checked) ? checked.failure : [];
}

function foldOf({ body, bodyLine }: DocumentParts): Checked<FoldPart> {
  if (body.trim() === '') {
    return Result.fail([
      {
        line: bodyLine,
        pointer: '',
        detail: 'The definition has no program: write the module with its fold after the front matter',
      },
    ]);
  }
  return Result.succeed({ fold: body, foldLine: bodyLine });
}

function languageOf(written: string, lines: SourceLines): Checked<typeof language> {
  return written === language ? Result.succeed(language) : Result.fail([issueAt(lines, '/language', oneLanguage)]);
}

function schemaOf(document: Schema.JsonObject | undefined, what: string, lines: SourceLines): Checked<ValueContract> {
  if (document === undefined) {
    return Result.succeed({});
  }
  return Result.mapBoth(compileJsonSchema(document, { what, nesting: mostValueDepth }), {
    onSuccess: (schema) => ({ schema }),
    onFailure: (issues) => issues.map(({ pointer, detail }) => issueAt(lines, `/${what}/schema${pointer}`, detail)),
  });
}

function contractOf(section: ValueSection, name: 'input' | 'output', lines: SourceLines): Checked<ValueContract> {
  return schemaOf(section?.schema, name, lines);
}

function initialIssues(initial: Schema.Json, schema: CompiledSchema | undefined): readonly string[] {
  const bytes = jsonBytesOf(initial);
  if (bytes > recallBounds.mostViewBytes) {
    return [`initial takes ${bytes} bytes as JSON, more than the ${recallBounds.mostViewBytes} a view may`];
  }
  const checked = schema?.validate(initial);
  return checked === undefined || Result.isSuccess(checked)
    ? []
    : checked.failure.map(
        ({ pointer, detail }) =>
          `initial does not match the view's schema at ${pointer === '' ? 'its root' : pointer}: ${detail}`,
      );
}

function viewOf(front: RecallFrontMatter, lines: SourceLines): Checked<ViewPart> {
  const initial = front.view?.initial ?? null;
  return Result.flatMap(schemaOf(front.view?.schema, 'view', lines), ({ schema }) => {
    const issues = initialIssues(initial, schema).map((detail) => issueAt(lines, '/view/initial', detail));
    return issues.length > 0
      ? Result.fail(issues)
      : Result.succeed(schema === undefined ? { initial } : { initial, schema });
  });
}

interface Parts {
  readonly language: typeof language;
  readonly input: ValueContract;
  readonly output: ValueContract;
  readonly view: ViewPart;
  readonly filters: readonly ViewFilter[];
  readonly fold: FoldPart;
}

function filterExpressionsOf(filters: readonly ViewFilter[], lines: SourceLines): readonly FilterExpression[] {
  return filters.flatMap((filter, index) => {
    const source = enclosedBody(filter['data']);
    const pointer = `/source/events/${index}/data`;
    return source === undefined ? [] : [{ source, pointer, line: issueAt(lines, pointer, '').line }];
  });
}

function assembled(
  { description }: Pick<RecallFrontMatter, 'description'>,
  parts: Parts,
  lines: SourceLines,
): RecallFunctionDefinitionDocument {
  const { input, output, view, filters, fold } = parts;
  return {
    ...(description === undefined ? {} : { description }),
    language,
    input,
    output,
    answers: exportedAnswer.test(fold.fold),
    filterExpressions: filterExpressionsOf(filters, lines),
    details: {
      language,
      ...fold,
      filters,
      initial: view.initial,
      ...(view.schema === undefined ? {} : { schema: view.schema.document }),
    },
  };
}

function documentFrom(
  { root, lines, issues }: ReadFrontMatter,
  fold: () => Checked<FoldPart>,
): Checked<RecallFunctionDefinitionDocument> {
  const decoded = decodeFrontMatter(root);
  if (issues.length > 0 || Result.isFailure(decoded)) {
    return Result.fail([...issues, ...issuesOf(fold)]);
  }
  const front = decoded.success;
  const parts = {
    language: languageOf(front.language, lines),
    input: contractOf(front.input, 'input', lines),
    output: contractOf(front.output, 'output', lines),
    view: viewOf(front, lines),
    filters: filtersOf(front.source.events, lines),
    fold: fold(),
  };
  const found = [
    ...issuesOf(() => parts.language),
    ...issuesOf(() => parts.input),
    ...issuesOf(() => parts.output),
    ...issuesOf(() => parts.view),
    ...issuesOf(() => parts.filters),
    ...issuesOf(() => parts.fold),
  ];
  return found.length > 0
    ? Result.fail(found)
    : Result.map(Result.all(parts), (checked) => assembled(front, checked, lines));
}

function documentOf(parts: DocumentParts): Checked<RecallFunctionDefinitionDocument> {
  const fold = foldOf(parts);
  const reading = frontMatterIn(parts.frontMatter, parts.frontMatterLine, recallFrontMatter);
  return Result.isFailure(reading)
    ? Result.fail([...reading.failure, ...issuesOf(() => fold)])
    : documentFrom(reading.success, () => fold);
}

export function parseRecallDocument(source: string): Checked<RecallFunctionDefinitionDocument> {
  return Result.mapError(
    Result.flatMap(splitDocument(source, 'A recall function definition'), documentOf),
    reportedIssues,
  );
}
