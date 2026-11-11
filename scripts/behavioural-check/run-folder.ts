import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Schema } from 'effect';

import { AnswerSchema, type Answer } from './models.ts';
import { ProfileSchema, ShownSchema } from './prompts.ts';

export const RunSchema = Schema.Struct({
  profile: ProfileSchema,
  briefs: Schema.Array(Schema.String),
  server_name: Schema.String,
  starter: Schema.String,
  texts: Schema.Array(Schema.String),
  prompts: Schema.Record(Schema.String, Schema.String),
  shown: ShownSchema,
});

export type Run = typeof RunSchema.Type;

export const ModelRunSchema = Schema.Struct({ command: Schema.Array(Schema.String), version: Schema.String });

export function jsonIn<S extends Schema.Codec<unknown, unknown>>(path: string, schema: S): S['Type'] {
  return Schema.decodeUnknownSync(Schema.fromJsonString(schema))(readFileSync(path, 'utf8'));
}

export function written(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 1)}\n`);
}

export function digestOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function promptPath(folder: string, brief: string): string {
  return join(folder, 'prompts', `${brief}.txt`);
}

export function answerPaths(folder: string, model: string, brief: string): readonly [string, string] {
  const answers = join(folder, 'answers', model);
  return [join(answers, `${brief}.json`), join(answers, `${brief}.loaded.json`)];
}

export function modelRunPath(folder: string, model: string): string {
  return join(folder, 'answers', model, 'model.json');
}

export function runPath(folder: string): string {
  return join(folder, 'run.json');
}

export async function askedOnce(path: string, asking: () => Promise<Answer>): Promise<Answer> {
  if (existsSync(path)) {
    return jsonIn(path, AnswerSchema);
  }
  const answer = await asking();
  written(path, answer);
  return answer;
}

export function modelsAnsweredIn(folder: string): readonly string[] {
  const answers = join(folder, 'answers');
  return existsSync(answers) ? readdirSync(answers) : [];
}

export function answersIn(folder: string, model: string, brief: string): readonly Answer[] {
  return answerPaths(folder, model, brief)
    .filter((path) => existsSync(path))
    .map((path) => jsonIn(path, AnswerSchema));
}
