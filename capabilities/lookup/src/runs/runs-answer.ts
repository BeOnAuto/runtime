import { mostResultBytes, type SucceededRun } from '@on.auto/definitions';
import { jsonBytesOf } from '@on.auto/workflow-engine/dsl';
import type { Schema } from 'effect';

interface ReadRecord {
  readonly examined: number;
  readonly through: string | null;
}

export interface Answering {
  readonly entries: readonly Schema.JsonObject[];
  readonly entriesBytes: number;
  readonly record: ReadRecord;
}

export interface RunsAnswer {
  readonly output: Schema.JsonObject;
  readonly record: Schema.JsonObject;
}

const runFields: Schema.JsonObject = {
  run_id: { type: 'string', description: 'The id of the run' },
  definition_version: { type: 'integer', minimum: 1, description: 'The version of the definition the run ran' },
  started_at: { type: 'string', description: 'When the run started, in ISO 8601 UTC' },
  finished_at: { type: 'string', description: 'When the run finished, in ISO 8601 UTC' },
  output: { description: "The run's output, as the run answered it" },
  bytes: {
    type: 'integer',
    minimum: 0,
    description:
      "The size of the run's output as JSON, in bytes, in place of an output that does not fit in the answer",
  },
};

export const runsAnswerSchema: Schema.JsonObject = {
  type: 'object',
  required: ['runs', 'more'],
  additionalProperties: false,
  properties: {
    runs: {
      type: 'array',
      description:
        'The runs of the definition that succeeded, newest started first, each with its output, or with its size where the output does not fit',
      items: {
        type: 'object',
        required: ['run_id', 'definition_version', 'started_at', 'finished_at'],
        additionalProperties: false,
        properties: runFields,
      },
    },
    more: {
      type: 'boolean',
      description: 'true when older runs are left unread: an output did not fit, or the read reached its bound',
    },
  },
};

export const nothingAnswered: Answering = { entries: [], entriesBytes: 0, record: { examined: 0, through: null } };

export function wholeEntryOf({ run_id, definition_version, started_at, finished_at, output }: SucceededRun) {
  return { run_id, definition_version, started_at, finished_at, output };
}

export function sizedEntryOf({ run_id, definition_version, started_at, finished_at, output }: SucceededRun) {
  return { run_id, definition_version, started_at, finished_at, bytes: jsonBytesOf(output) };
}

export function withEntry(answering: Answering, entry: Schema.JsonObject, record: ReadRecord): Answering {
  return {
    entries: [...answering.entries, entry],
    entriesBytes: answering.entriesBytes + jsonBytesOf(entry),
    record,
  };
}

export function answerOf({ entries, record }: Answering, more: boolean): RunsAnswer {
  return { output: { runs: entries, more }, record: { examined: record.examined, through: record.through } };
}

export function fits({ entries, entriesBytes, record }: Answering, more: boolean): boolean {
  const separators = Math.max(entries.length - 1, 0);
  const answered = jsonBytesOf({ runs: [], more }) + entriesBytes + separators;
  return answered + jsonBytesOf({ examined: record.examined, through: record.through }) <= mostResultBytes;
}
