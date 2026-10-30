import { boundedCacheOf, type BoundedCache } from '../dsl/bounded-cache.ts';
import type { Json, JsonObject } from '../dsl/json.ts';
import type { FoldAnswerData } from '../folds/fold-answer.ts';
import type { FoldHost, ViewCheck } from '../folds/fold-page.ts';
import type { CheckAnswer, CheckJob } from './check-messages.ts';
import type { FoldJob } from './fold-messages.ts';
import { unchecked, type OutputCheck, type ProgramAnswerData, type ProgramHost } from './program-answer.ts';
import type { ProgramJob } from './program-messages.ts';

export interface ValueChecks {
  readonly output: (schema: Json) => OutputCheck;
  readonly view: (schema: JsonObject) => ViewCheck;
}

export type ProgramHandler = (request: ProgramJob, host: ProgramHost) => ProgramAnswerData;

export type FoldHandler = (request: FoldJob, host: FoldHost) => FoldAnswerData;

export type CheckHandler = (request: CheckJob) => CheckAnswer;

export interface JobHandlers {
  readonly program?: ProgramHandler;
  readonly fold?: FoldHandler;
  readonly check?: CheckHandler;
  readonly checks?: ValueChecks;
}

export interface Kept {
  readonly outputCheck: (schema: Json) => OutputCheck;
  readonly viewCheck: (schema: JsonObject) => ViewCheck;
}

const mostCachedSchemaCharacters = 262_144;

const noViewSchemaChecked = 'This worker checks no view schema; a page whose views keep one names a worker that does';

function remembered<Value>(cache: BoundedCache<Value>, key: string, make: () => Value): Value {
  const known = cache.get(key);
  if (known !== undefined) {
    return known;
  }
  const made = make();
  cache.set(key, made);
  return made;
}

export function keptFor(checks: ValueChecks | undefined): Kept {
  const outputs = boundedCacheOf<OutputCheck>(mostCachedSchemaCharacters);
  const views = boundedCacheOf<ViewCheck>(mostCachedSchemaCharacters);
  return {
    outputCheck: (schema) =>
      checks === undefined || schema === null
        ? unchecked
        : remembered(outputs, JSON.stringify(schema), () => checks.output(schema)),
    viewCheck: (schema) =>
      checks === undefined
        ? () => noViewSchemaChecked
        : remembered(views, JSON.stringify(schema), () => checks.view(schema)),
  };
}
