import { JsonPointer, Predicate, Schema } from 'effect';

import { ScopeLacking, scopeLackingIn, scopeLackingWords } from './scope-lacking.ts';

const codedKinds = ['key_refused', 'scope_lacking', 'rate_limited'] as const;

type CodedKind = (typeof codedKinds)[number];

const jsonPointer = /^(?:\/(?:[^~/]|~[01])*)+$/u;

const pointerExamples = { succeeded: '/ok', code: '/error' } as const;

const Codes = Schema.Array(Schema.String);

export const FailureCodesSchema = Schema.Struct({
  succeeded: Schema.String.annotate({
    description: `A JSON pointer to the boolean of a JSON answer that says whether the call succeeded, false for a failure, such as ${pointerExamples.succeeded}`,
  }),
  code: Schema.String.annotate({
    description: `A JSON pointer to the string of a failed answer that names its failure, such as ${pointerExamples.code}`,
  }),
  key_refused: Schema.optionalKey(
    Codes.annotate({ description: 'The codes that say the API refused the credential, as a 401 says elsewhere' }),
  ),
  scope_lacking: Schema.optionalKey(
    Codes.annotate({ description: 'The codes that say the credential lacks a scope the call needs' }),
  ),
  rate_limited: Schema.optionalKey(
    Codes.annotate({ description: 'The codes that say the API limits the rate of its calls, as a 429 says elsewhere' }),
  ),
}).annotate({
  description:
    'For an HTTP API that answers a failure in a JSON answer of a successful status: where the answer says whether the call succeeded and the code that names its failure, and the codes that mean a refused credential, a lacking scope or a limited rate; any other failed answer is an error result carrying the answer',
});

export type FailureCodes = typeof FailureCodesSchema.Type;

interface FailureCodeIssue {
  readonly path: readonly (string | number)[];
  readonly detail: string;
}

export class AnsweredCode extends Error {
  readonly kind: CodedKind;

  constructor(kind: CodedKind, code: string) {
    super(kind === 'scope_lacking' ? scopeLackingWords(undefined, code) : `The tool server answered ${code}`);
    this.kind = kind;
  }
}

function pointerIssuesOf(codes: FailureCodes): readonly FailureCodeIssue[] {
  return (['succeeded', 'code'] as const)
    .filter((field) => !jsonPointer.test(codes[field]))
    .map((field) => ({
      path: [field],
      detail: `Expected a JSON pointer into the answer, such as ${pointerExamples[field]}`,
    }));
}

function emptyListIssuesOf(codes: FailureCodes): readonly FailureCodeIssue[] {
  return codedKinds
    .filter((kind) => codes[kind]?.length === 0)
    .map((kind) => ({ path: [kind], detail: `Expected at least one code; leave ${kind} out where no code means it` }));
}

interface NamedCode {
  readonly kind: CodedKind;
  readonly code: string;
  readonly index: number;
}

function namedTwiceIssuesOf(codes: FailureCodes): readonly FailureCodeIssue[] {
  const named: readonly NamedCode[] = codedKinds.flatMap((kind) =>
    (codes[kind] ?? []).map((code, index) => ({ kind, code, index })),
  );
  return named
    .filter(({ code }, at) => named.findIndex((each) => each.code === code) < at)
    .map(({ kind, code, index }) => ({
      path: [kind, index],
      detail: `${code} is named twice, and a code means one failure`,
    }));
}

export function failureCodesOf(codes?: FailureCodes): { readonly failure_codes?: FailureCodes } {
  return codes === undefined ? {} : { failure_codes: codes };
}

export function failureCodeIssuesOf(codes?: FailureCodes): readonly FailureCodeIssue[] {
  return codes === undefined
    ? []
    : [...pointerIssuesOf(codes), ...emptyListIssuesOf(codes), ...namedTwiceIssuesOf(codes)];
}

function valueAt(answer: unknown, pointer: string): unknown {
  return pointer
    .split('/')
    .slice(1)
    .reduce<unknown>((value, token) => {
      const key = JsonPointer.unescapeToken(token);
      return Predicate.hasProperty(value, key) && Object.hasOwn(value, key) ? value[key] : undefined;
    }, answer);
}

interface FailedAnswer {
  readonly error: Error | undefined;
}

function failedWith(codes: FailureCodes, code: unknown): FailedAnswer {
  if (typeof code !== 'string') {
    return { error: undefined };
  }
  const kind = codedKinds.find((each) => (codes[each] ?? []).includes(code));
  return { error: kind === undefined ? undefined : new AnsweredCode(kind, code) };
}

export function failedAnswerOf(codes: FailureCodes, answer: unknown): FailedAnswer | undefined {
  return valueAt(answer, codes.succeeded) === false ? failedWith(codes, valueAt(answer, codes.code)) : undefined;
}

interface Challenge {
  readonly error?: string | undefined;
  readonly scope?: string | undefined;
}

interface ReadAnswer {
  readonly status: number;
  readonly text: string;
  readonly challenge: Challenge;
  readonly json: { readonly parsed: unknown } | undefined;
}

export function refusalOf(answer: ReadAnswer, codes: FailureCodes | null): FailedAnswer | undefined {
  const { status, text, challenge, json } = answer;
  const lacking = scopeLackingIn({ status, body: text, error: challenge.error, scope: challenge.scope });
  if (lacking !== undefined) {
    return { error: new ScopeLacking(lacking) };
  }
  return codes === null || json === undefined ? undefined : failedAnswerOf(codes, json.parsed);
}
