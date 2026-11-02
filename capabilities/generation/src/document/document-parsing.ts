import {
  frontMatterIn,
  reportedIssues,
  splitDocument,
  type DocumentIssue,
  type DocumentParts,
  type ReadFrontMatter,
} from '@on.auto/definitions/document';
import { Result } from 'effect';

import { expiresOf, inputOf, kindOf, modelOf, parametersOf, referencesOf, type Checked } from './document-parts.ts';
import { decodeFrontMatter, generationFrontMatter, type FrontMatter } from './front-matter.ts';
import type { GenerationFunctionDefinitionDocument } from './generation-document.ts';
import { promptOf } from './prompt-template.ts';

function issuesOf(check: () => Checked<unknown>): readonly DocumentIssue[] {
  const checked = check();
  return Result.isFailure(checked) ? checked.failure : [];
}

function documentFrom(
  written: FrontMatter,
  { lines }: ReadFrontMatter,
  parts: DocumentParts,
): Checked<GenerationFunctionDefinitionDocument> {
  const produces = kindOf(written.produces, lines);
  const checked = {
    produces,
    model: modelOf(written.model, lines),
    input: inputOf(written.input?.schema, lines),
    parameters: Result.match(produces, {
      onFailure: () => Result.succeed({}),
      onSuccess: (kind) => parametersOf(written.parameters, kind, lines),
    }),
    references: referencesOf(written.references, lines),
    expiry: expiresOf(written.expires, lines),
    prompt: promptOf(parts, written.input?.schema),
  };
  const found = [
    ...issuesOf(() => checked.produces),
    ...issuesOf(() => checked.model),
    ...issuesOf(() => checked.input),
    ...issuesOf(() => checked.parameters),
    ...issuesOf(() => checked.references),
    ...issuesOf(() => checked.expiry),
    ...issuesOf(() => checked.prompt),
  ];
  if (found.length > 0) {
    return Result.fail(found);
  }
  return Result.map(Result.all(checked), ({ expiry, ...document }) => ({
    ...(written.description === undefined ? {} : { description: written.description }),
    ...document,
    ...expiry,
    lines,
  }));
}

function documentOf(parts: DocumentParts): Checked<GenerationFunctionDefinitionDocument> {
  return Result.flatMap(frontMatterIn(parts.frontMatter, parts.frontMatterLine, generationFrontMatter), (reading) => {
    const decoded = decodeFrontMatter(reading.root);
    if (reading.issues.length > 0 || Result.isFailure(decoded)) {
      return Result.fail([...reading.issues, ...issuesOf(() => promptOf(parts))]);
    }
    return documentFrom(decoded.success, reading, parts);
  });
}

export function parseGenerationDocument(source: string): Checked<GenerationFunctionDefinitionDocument> {
  return Result.mapError(
    Result.flatMap(splitDocument(source, 'A generation function definition'), documentOf),
    reportedIssues,
  );
}
