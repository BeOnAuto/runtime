import { issueAt, type DocumentIssue, type SourceLines, type ValueContract } from '@on.auto/definitions/document';
import { compileJsonSchema } from '@on.auto/json-schema';
import { listed } from '@on.auto/phrasing';
import { readDuration, mostValueDepth } from '@on.auto/workflow-engine/dsl';
import { Result, type Schema } from 'effect';

import { modelIdPattern, type GenerationKind } from '../catalog/catalog-entry.ts';
import { parametersOfKind } from './front-matter.ts';
import type { GenerationParameters, ParameterName } from './generation-document.ts';

export type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

const expiryBounds = { shortestMs: 3_600_000, longestMs: 3650 * 86_400_000 } as const;

const gatewayPrefix = /^[a-z][a-z0-9-]{0,31}$/u;

const kinds: readonly GenerationKind[] = ['image', 'audio', 'video'];

function one(lines: SourceLines, pointer: string, detail: string): Checked<never> {
  return Result.fail([issueAt(lines, pointer, detail)]);
}

export function kindOf(written: string, lines: SourceLines): Checked<GenerationKind> {
  const kind = kinds.find((each) => each === written);
  return kind === undefined ? one(lines, '/produces', 'Expected image, audio or video') : Result.succeed(kind);
}

export function modelOf(written: string, lines: SourceLines): Checked<string> {
  const split = written.indexOf('/');
  const named =
    split > 0 && gatewayPrefix.test(written.slice(0, split)) && modelIdPattern.test(written.slice(split + 1));
  return named
    ? Result.succeed(written)
    : one(lines, '/model', 'A model is written gateway/model, such as gateway/openai/gpt-image-1');
}

export function inputOf(document: Schema.JsonObject | undefined, lines: SourceLines): Checked<ValueContract> {
  if (document === undefined) {
    return Result.succeed({});
  }
  return Result.mapBoth(compileJsonSchema(document, { what: 'input', nesting: mostValueDepth }), {
    onSuccess: (schema) => ({ schema }),
    onFailure: (issues) => issues.map(({ pointer, detail }) => issueAt(lines, `/input/schema${pointer}`, detail)),
  });
}

export function parametersOf(
  given: GenerationParameters | undefined,
  kind: GenerationKind,
  lines: SourceLines,
): Checked<GenerationParameters> {
  const parameters = given ?? {};
  const taken = parametersOfKind[kind];
  const named: readonly ParameterName[] = ['size', 'aspect', 'quality', 'voice', 'format', 'duration'];
  const issues = named
    .filter((name) => parameters[name] !== undefined && !taken.includes(name))
    .map((name) =>
      issueAt(lines, `/parameters/${name}`, `${name} is not a parameter of ${kind}, which takes ${listed(taken)}`),
    );
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(parameters);
}

const pointer = /^(?:\/[^/]*)+$/u;

export function referencesOf(written: readonly string[] | undefined, lines: SourceLines): Checked<readonly string[]> {
  const references = written ?? [];
  const issues = references.flatMap((reference, index) => {
    if (!pointer.test(reference)) {
      return [issueAt(lines, `/references/${index}`, 'Expected a JSON Pointer into the input, such as /photo')];
    }
    return references.indexOf(reference) < index
      ? [issueAt(lines, `/references/${index}`, `${reference} is named more than once`)]
      : [];
  });
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(references);
}

const expiryWords = 'An asset expires after a duration from one hour to 3650 days, such as P30D';

export interface Expiry {
  readonly expiresMs?: number;
}

export function expiresOf(written: string | undefined, lines: SourceLines): Checked<Expiry> {
  if (written === undefined) {
    return Result.succeed({});
  }
  const reading = readDuration(written);
  if ('problem' in reading) {
    return one(lines, '/expires', `${reading.problem}. ${expiryWords}`);
  }
  const { milliseconds } = reading;
  return milliseconds >= expiryBounds.shortestMs && milliseconds <= expiryBounds.longestMs
    ? Result.succeed({ expiresMs: milliseconds })
    : one(lines, '/expires', `${written} is not a time an asset may be kept. ${expiryWords}`);
}
