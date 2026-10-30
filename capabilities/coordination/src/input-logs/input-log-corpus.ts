import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { RunLogEventSchema, RunInputSchema, type RunLogEvent, type RunInput } from '@on.auto/workflow-engine';
import { Schema } from 'effect';

export interface InputLog {
  readonly name: string;
  readonly inputs: readonly RunInput[];
  readonly events: readonly RunLogEvent[];
}

export type Environment = Readonly<Record<string, string | undefined>>;

const InputLogSchema = Schema.Struct({
  name: Schema.String,
  inputs: Schema.Array(RunInputSchema),
  events: Schema.Array(RunLogEventSchema),
});

const InputLogTextSchema = Schema.fromJsonString(Schema.toCodecJson(InputLogSchema));

const decodeInputLog = Schema.decodeUnknownSync(InputLogTextSchema);

const encodeInputLog = Schema.encodeSync(Schema.toCodecJson(InputLogSchema));

const committedCorpus = fileURLToPath(new URL('../../input-logs/', import.meta.url));

export function recordInputLog(log: InputLog, environment: Environment, corpus = committedCorpus): void {
  if (environment['RECORD_INPUT_LOGS'] !== '1') {
    return;
  }
  mkdirSync(corpus, { recursive: true });
  writeFileSync(`${corpus}${log.name}.json`, `${JSON.stringify(encodeInputLog(log), null, 1)}\n`);
}

export function recordedInputLogs(corpus = committedCorpus): readonly InputLog[] {
  return readdirSync(corpus)
    .filter((file) => file.endsWith('.json'))
    .toSorted()
    .map((file) => decodeInputLog(readFileSync(`${corpus}${file}`, 'utf8')));
}
