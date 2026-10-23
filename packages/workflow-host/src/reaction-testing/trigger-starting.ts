import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import type { FilterVerdict, MatchedFilter } from '@on.auto/workflow-engine';
import { filterSandboxOf } from '@on.auto/workflow-engine/dsl';
import { Array, Effect, Function } from 'effect';

import { filterMatchingOf, filterStops, type FilterStops, type MatchFilters } from '../filtering/filter-matching.ts';
import type { ReactionStart } from '../reactions/reaction-options.ts';
import { subscriptionStarts } from '../reactions/subscription-starts.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { saidRefusals, type followedRecordOf } from './followed-records.ts';

const topRuns: ReadonlyMap<string, string> = new Map([
  ['r-of-close', 'close'],
  ['r-of-other', 'other'],
]);

export const stopsByItsMemory = '${ "stops by its memory" }';

export const stopsByItsWork = '${ "stops by its work" }';

interface ScriptedStop {
  readonly title: string;
  readonly stopped: boolean;
}

const scriptedStops: ReadonlyMap<string, ScriptedStop> = new Map([
  [
    stopsByItsMemory,
    {
      title: 'The program used more memory than it may: one filter may use the memory of its sandbox and no more',
      stopped: true,
    },
  ],
  [
    stopsByItsWork,
    {
      title:
        'The program did more work than it may: an expression of a filter may do 250 checkpoints of work, and those of one filter 500 together',
      stopped: false,
    },
  ],
]);

function scriptedVerdictOf({ reference, attributes }: MatchedFilter): FilterVerdict | undefined {
  const data = attributes['data'];
  const stop = typeof data === 'string' ? scriptedStops.get(data) : undefined;
  return stop === undefined
    ? undefined
    : {
        error: {
          type: 'runtime',
          status: 500,
          title: stop.title,
          instance: reference,
        },
        stopped: stop.stopped,
      };
}

interface CountingMatches {
  readonly match: MatchFilters;
  readonly stops: FilterStops;
  readonly evaluated: () => readonly string[];
}

export function countingMatches(): CountingMatches {
  const evaluated: string[] = [];
  const matching = filterMatchingOf(filterSandboxOf(shippedFilesOnDisk));
  return {
    match: (filters, event, now) => {
      evaluated.push(...filters.map(({ reference }) => reference));
      return Effect.map(
        Effect.forEach(filters, (filter) => {
          const scripted = scriptedVerdictOf(filter);
          return scripted === undefined ? matching([filter], event, now) : Effect.succeed([scripted]);
        }),
        Array.flatten,
      );
    },
    stops: filterStops(),
    evaluated: () => evaluated,
  };
}

export async function starting() {
  const database = await openedOn(await onSQLite());
  const starts: ReactionStart[] = [];
  const { refusals, said } = saidRefusals();
  const { match, stops, evaluated } = countingMatches();
  const consumer = subscriptionStarts({
    database,
    starting: {
      start: (_playbookKey, start) =>
        Effect.sync(() => {
          starts.push(start);
        }),
      startDeferred: Function.constant(Effect.succeed(0)),
    },
    refusals,
    workflowOfRun: (_playbookKey, runId) => Effect.succeed(topRuns.get(runId)),
    match,
    stops,
    now: () => 0,
  });
  const delivered = (followed: ReturnType<typeof followedRecordOf>) =>
    Effect.runPromise(
      Effect.flatMap(consumer.batchOf(followed, undefined, 100), ({ deliveries }) =>
        Effect.forEach(deliveries, ({ deliver }) => deliver, { discard: true }),
      ),
    );
  const tried = (followed: ReturnType<typeof followedRecordOf>) =>
    Effect.runPromise(
      Effect.flatMap(consumer.batchOf(followed, undefined, 100), ({ deliveries }) =>
        Effect.forEach(deliveries, ({ workflow, deliver }) =>
          Effect.map(Effect.isSuccess(deliver), (made) => `${workflow} ${made ? 'delivered' : 'waits'}`),
        ),
      ),
    );
  return { database, consumer, delivered, tried, starts: () => starts, said, evaluated };
}
