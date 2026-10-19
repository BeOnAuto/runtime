import { Buffer } from 'node:buffer';

import type { DocumentIssue, DocumentParts } from '@on.auto/definitions/document';
import {
  outputText,
  parsedTemplate,
  renderedTemplate,
  templateEngine,
  type ParsedTemplate,
  type RenderClock,
  type RenderFailure,
  type TemplateEngine,
} from '@on.auto/definitions/template';
import { Predicate, Result, type Schema } from 'effect';
import { toValue } from 'liquidjs';

import { figure } from '../capability/figures.ts';
import { predictionBounds } from '../capability/prediction-bounds.ts';
import type { Checked } from '../document/checked-parts.ts';
import { briefVariableIssues, renderedNameOf } from './brief-variables.ts';

const briefEngine = templateEngine();

export type BriefVariables = Readonly<Record<'dataset' | 'function', Schema.JsonObject>>;

type BriefRefusal = { readonly reason: 'not_text' | 'too_long'; readonly line: number };

export type BriefFailure = RenderFailure | BriefRefusal;

class BriefRefused extends Error {
  readonly refusal: BriefRefusal['reason'];

  constructor(refusal: BriefRefusal['reason']) {
    super(refusal);
    this.refusal = refusal;
  }
}

interface BriefEmitter {
  buffer: string;
  bytes: number;
  readonly write: (html: unknown) => void;
}

function briefEmitter(mostBytes: number): BriefEmitter {
  const emitter: BriefEmitter = {
    buffer: '',
    bytes: 0,
    write: (html) => {
      const value: unknown = toValue(html);
      if (Predicate.isObjectOrArray(value)) {
        throw new BriefRefused('not_text');
      }
      const text = outputText(value);
      emitter.bytes += Buffer.byteLength(text, 'utf8');
      if (emitter.bytes > mostBytes) {
        throw new BriefRefused('too_long');
      }
      emitter.buffer += text;
    },
  };
  return emitter;
}

function refusalOf(cause: unknown, line: number): BriefRefusal | undefined {
  return cause instanceof BriefRefused ? { reason: cause.refusal, line } : undefined;
}

export function renderedBrief(
  parsed: ParsedTemplate,
  variables: BriefVariables,
  clock: RenderClock,
  engine: TemplateEngine = briefEngine,
): Result.Result<string, BriefFailure> {
  const emitter = briefEmitter(predictionBounds.mostBriefBytes);
  return Result.map(renderedTemplate(engine, parsed, { variables, emitter, refusalOf, clock }), () => emitter.buffer);
}

const failureWords: {
  readonly [Reason in BriefFailure['reason']]: (failure: Extract<BriefFailure, { readonly reason: Reason }>) => string;
} = {
  missing_variable: ({ variable }) =>
    `The brief reads ${renderedNameOf(variable)}, which the largest dataset the bounds admit does not have`,
  limit_exceeded: ({ limit }) =>
    `The brief takes more ${limit} to render than a template may, over the largest dataset the bounds admit`,
  failed: ({ detail }) => `The brief does not render: ${detail}`,
  not_text: () => 'The brief writes a list or a mapping where text goes; write its items, or use the json filter',
  too_long: () =>
    `The brief renders to more than ${figure(predictionBounds.mostBriefBytes)} bytes over the largest dataset the bounds admit; shorten it or loop over less`,
};

function wordsOf<Reason extends BriefFailure['reason']>(
  failure: Extract<BriefFailure, { readonly reason: Reason }>,
): string {
  const words: (failure: Extract<BriefFailure, { readonly reason: Reason }>) => string = failureWords[failure.reason];
  return words(failure);
}

export function compiledBrief({ body, bodyLine }: DocumentParts): Checked<ParsedTemplate> {
  if (body.trim() === '') {
    return Result.fail([
      { line: bodyLine, pointer: '', detail: 'The definition has no brief: write it after the front matter' },
    ]);
  }
  return Result.flatMap(
    Result.mapError(parsedTemplate(briefEngine, body, bodyLine), (issues) =>
      issues.map(({ line, detail }) => ({ line, pointer: '', detail })),
    ),
    (parsed) => {
      const issues = [
        ...parsed.issues.map(({ line, detail }) => ({ line, pointer: '', detail })),
        ...briefVariableIssues(parsed.variables),
      ];
      return issues.length > 0 ? Result.fail(issues) : Result.succeed(parsed);
    },
  );
}

export function briefRenderIssues(
  parsed: ParsedTemplate,
  largest: BriefVariables,
  clock: RenderClock,
  engine: TemplateEngine = briefEngine,
): readonly DocumentIssue[] {
  const rendered = renderedBrief(parsed, largest, clock, engine);
  return Result.isSuccess(rendered)
    ? []
    : [{ line: rendered.failure.line, pointer: '', detail: wordsOf(rendered.failure) }];
}
