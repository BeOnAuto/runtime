import { Array as Arr, Effect, Option, Schema } from 'effect';

import { languageModelLayer } from '../providers/language-model-layer.ts';
import { answerCheck, type AnswerCheckReport, type CaseReport, type ModelReport } from './answer-check.ts';
import { checkCases } from './check-cases.ts';
import { checkGateways, scriptedCheckFetch } from './scripted-checks.ts';

interface Checked {
  readonly report: AnswerCheckReport;
  readonly sent: () => readonly unknown[];
}

export async function checked(...models: readonly string[]): Promise<Checked> {
  const scripted = scriptedCheckFetch();
  const report = await Effect.runPromise(
    answerCheck(models).pipe(Effect.provide(languageModelLayer(checkGateways, { fetch: scripted.fetch }))),
  );
  return { report, sent: () => scripted.requests().map(({ body }) => body) };
}

export function firstModelOf({ models }: AnswerCheckReport): ModelReport {
  return Option.getOrThrow(Arr.head(models));
}

export async function modelChecked(model: string): Promise<ModelReport> {
  return firstModelOf((await checked(model)).report);
}

export function outcomesOf({ cases }: ModelReport): Readonly<Record<string, string>> {
  return Object.fromEntries(cases.map((one) => [one.case, one.outcome]));
}

type Untimed = Omit<CaseReport, 'duration_ms' | 'schema_refusal'> & {
  readonly schema_refusal?: Omit<NonNullable<CaseReport['schema_refusal']>, 'duration_ms'>;
};

function untimed({ duration_ms: _taken, schema_refusal: refusal, ...rest }: CaseReport): Untimed {
  if (refusal === undefined) {
    return rest;
  }
  const { duration_ms: _refused, ...refused } = refusal;
  return { ...rest, schema_refusal: refused };
}

export function caseOf({ cases }: ModelReport, name: string): Untimed {
  return untimed(Option.getOrThrow(Arr.findFirst(cases, (one) => one.case === name)));
}

export const caseNames = checkCases.map(({ name }) => name);

export function everyCase(outcome: string): Readonly<Record<string, string>> {
  return Object.fromEntries(caseNames.map((name) => [name, outcome]));
}

const sentFormatOf = Schema.decodeUnknownSync(
  Schema.Struct({
    response_format: Schema.optionalKey(Schema.Struct({ json_schema: Schema.Struct({ schema: Schema.Unknown }) })),
  }),
);

export function schemasSent(bodies: readonly unknown[]): readonly unknown[] {
  return bodies.flatMap((body) => {
    const sent = sentFormatOf(body).response_format;
    return sent === undefined ? [] : [sent.json_schema.schema];
  });
}

const toolAnswer = /"role":"tool","tool_call_id":"call_\w+","content":"[^"]*"/gu;

export function toolAnswersIn(bodies: readonly unknown[]): readonly string[] {
  return bodies.flatMap((body) => JSON.stringify(body).match(toolAnswer) ?? []).toSorted();
}

export function requestsWithTools(bodies: readonly unknown[]): readonly string[] {
  return bodies.map((body) => JSON.stringify(body)).filter((sent) => sent.includes('"tools"'));
}
