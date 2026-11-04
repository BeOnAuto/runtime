import {
  mostRecordsInAPage,
  RunContextSchema,
  type PlaybookAddress,
  type RecordedEvent,
  type RecordedPage,
  type RecordedPageRequest,
  type RecordedReader,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { NamedDefinition } from '../used-by/called-definitions.ts';
import { streamsOfRuns } from './list-runs.ts';
import { runsOf } from './listed-run.ts';
import { succeededTypes } from './run-status.ts';

export interface SucceededRun {
  readonly run_id: string;
  readonly definition_version: number;
  readonly started_at: string;
  readonly finished_at: string;
  readonly output: Schema.Json;
}

interface SucceededRunsPage {
  readonly runs: readonly SucceededRun[];
  readonly next?: string;
  readonly reached?: string;
}

interface SucceededRunsAsked {
  readonly place: PlaybookAddress;
  readonly definition: NamedDefinition;
  readonly after: string;
  readonly since?: string;
}

export type SucceededRunsReader = Pick<RecordedReader, 'readRecorded'>;

const decodeHeads = Schema.decodeUnknownEffect(
  Schema.Tuple([
    Schema.Struct({ type: Schema.Literal('run_started'), context: RunContextSchema }),
    Schema.Struct({
      type: Schema.Literal('run_succeeded'),
      data: Schema.Struct({ output: Schema.Json }),
      context: RunContextSchema,
    }),
  ]),
);

function succeededRunOf(heads: readonly RecordedEvent[]): Effect.Effect<SucceededRun> {
  return Effect.map(Effect.orDie(decodeHeads(heads)), ([started, succeeded]) => ({
    run_id: started.context.runId,
    definition_version: started.context.definitionVersion,
    started_at: started.context.at,
    finished_at: succeeded.context.at,
    output: succeeded.data.output,
  }));
}

function pageOf({ records, nextCursor, lastExamined }: RecordedPage): Effect.Effect<SucceededRunsPage> {
  return Effect.map(Effect.forEach(runsOf(records).values(), succeededRunOf), (runs: readonly SucceededRun[]) => ({
    runs,
    ...(nextCursor === null ? {} : { next: nextCursor }),
    ...(lastExamined === null ? {} : { reached: lastExamined.recordedAt }),
  }));
}

export function succeededRunsPageOf(
  reader: SucceededRunsReader,
  { place, definition, after, since }: SucceededRunsAsked,
): Effect.Effect<SucceededRunsPage> {
  const page: RecordedPageRequest = {
    order: 'desc',
    limit: mostRecordsInAPage,
    types: succeededTypes,
    dataOf: succeededTypes,
    cursor: after,
    ...(since === undefined ? {} : { since }),
  };
  return reader
    .readRecorded(place, streamsOfRuns(definition.type, definition.name), page)
    .pipe(Effect.orDie, Effect.flatMap(pageOf));
}
