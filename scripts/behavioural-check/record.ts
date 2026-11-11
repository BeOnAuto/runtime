import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import { Schema } from 'effect';

import { outcomeOf, planIn, toolsAskedIn, type Shape } from './grading.ts';
import type { Answer } from './models.ts';
import { ProfileSchema } from './prompts.ts';

const ResultSchema = Schema.Struct({
  types: Schema.NullOr(Schema.Array(Schema.String)),
  reasoning_names_tools: Schema.Array(Schema.Boolean),
  workflow_calls: Schema.Array(Schema.Number),
  loaded: Schema.Array(Schema.String),
  outcome: Schema.Literals(['right', 'under-split', 'over-split', 'no answer']),
});

type Result = typeof ResultSchema.Type;

const RowSchema = Schema.Struct({
  label: Schema.String,
  date: Schema.String,
  profile: ProfileSchema,
  server_name: Schema.String,
  starter: Schema.String,
  models: Schema.Record(Schema.String, Schema.Struct({ command: Schema.Array(Schema.String), version: Schema.String })),
  texts: Schema.Array(Schema.String),
  prompts: Schema.Record(Schema.String, Schema.String),
  results: Schema.Record(Schema.String, Schema.Record(Schema.String, ResultSchema)),
  note: Schema.optionalKey(Schema.String),
});

export type Row = typeof RowSchema.Type;

const decodeRow = Schema.decodeUnknownSync(Schema.fromJsonString(RowSchema));

export function resultOf(shape: Shape, answers: readonly Answer[]): Result {
  const last = answers.at(-1);
  const definitions = planIn(last?.stdout ?? '');
  const loaded = answers.length > 1 ? toolsAskedIn(answers[0]?.stdout ?? '') : [];
  if (definitions === undefined) {
    return { types: null, reasoning_names_tools: [], workflow_calls: [], loaded, outcome: 'no answer' };
  }
  const ofType = (type: string) => definitions.filter((definition) => definition.type === type);
  return {
    types: definitions.map(({ type }) => type ?? ''),
    reasoning_names_tools: ofType('reasoning').map(({ tools }) => (tools ?? []).length > 0),
    workflow_calls: ofType('workflow').map(({ calls }) => (calls ?? []).length),
    loaded,
    outcome: outcomeOf(shape, definitions),
  };
}

export function rowsIn(path: string): readonly Row[] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => decodeRow(line));
}

export function appendRow(path: string, row: Row): void {
  if (rowsIn(path).some(({ label }) => label === row.label)) {
    throw new Error(
      `The record already holds a row labelled ${row.label}; a row is never changed, so give this one another label`,
    );
  }
  appendFileSync(path, `${JSON.stringify(Schema.encodeSync(RowSchema)(row))}\n`);
}

const shortly: Readonly<Record<Result['outcome'], string>> = {
  right: 'right',
  'under-split': 'under',
  'over-split': 'over',
  'no answer': 'none',
};

export function tableOf({ label, profile, date, results }: Row): string {
  const models = Object.keys(results);
  const briefs = [...new Set(models.flatMap((model) => Object.keys(results[model] ?? {})))].toSorted();
  const cell = (model: string, brief: string) => {
    const result = results[model]?.[brief];
    return result === undefined ? '-' : shortly[result.outcome];
  };
  const right = (model: string) =>
    `${Object.values(results[model] ?? {}).filter(({ outcome }) => outcome === 'right').length}/${Object.keys(results[model] ?? {}).length}`;
  return [
    `${label} (${profile}, ${date})`,
    `| brief | ${models.join(' | ')} |`,
    `| --- | ${models.map(() => '---').join(' | ')} |`,
    ...briefs.map((brief) => `| ${brief} | ${models.map((model) => cell(model, brief)).join(' | ')} |`),
    `| right | ${models.map((model) => right(model)).join(' | ')} |`,
  ].join('\n');
}
