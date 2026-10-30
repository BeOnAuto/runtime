import {
  enclosedBody,
  filterTestingOf,
  type FilterSandbox,
  type FilterVerdict,
  type MatchedFilter,
} from '@on.auto/workflow-engine';
import type { PageEvent } from '@on.auto/workflow-host';
import { Effect, type Schema } from 'effect';

import { canonicalJson } from '../data/data-digest.ts';
import type { DatasetData } from './dataset-data.ts';

type EventMatch =
  | { readonly kind: 'taken' }
  | { readonly kind: 'not_taken' }
  | { readonly kind: 'refused'; readonly detail: string }
  | { readonly kind: 'stopped'; readonly detail: string };

export interface DatasetMatching {
  readonly matchOf: (placed: PageEvent) => Effect.Effect<EventMatch>;
  readonly close: () => Promise<void>;
}

type Filter = DatasetData['events'][number];

const taken: EventMatch = { kind: 'taken' };

const notTaken: EventMatch = { kind: 'not_taken' };

function isTested(filter: Filter): boolean {
  return Object.values(filter).some((expected) => enclosedBody(expected) !== undefined);
}

function holdsLiterally(filter: Filter, event: Schema.JsonObject): boolean {
  return Object.entries(filter).every(
    ([name, expected]: readonly [string, Schema.Json]) =>
      canonicalJson(expected) === canonicalJson(event[name] ?? null),
  );
}

function wordsOf({ error }: Extract<FilterVerdict, object>): string {
  return [error.title, error.detail].filter((part) => part !== undefined).join(': ');
}

function matchOfVerdicts(verdicts: readonly FilterVerdict[]): EventMatch {
  if (verdicts.includes(true)) {
    return taken;
  }
  const failures = verdicts.flatMap((verdict) => (typeof verdict === 'object' ? [verdict] : []));
  const [failed] = failures;
  if (failed === undefined) {
    return notTaken;
  }
  const stop = failures.find((failure) => failure.stopped);
  return stop === undefined
    ? { kind: 'refused', detail: `Its data test failed: ${wordsOf(failed)}` }
    : { kind: 'stopped', detail: wordsOf(stop) };
}

function typeFirst({ type, ...attributes }: Filter, index: number): MatchedFilter {
  return { reference: `/data/events/${index}`, attributes: { type, ...attributes } };
}

export function datasetMatchingOf(data: DatasetData, sandbox: FilterSandbox): DatasetMatching {
  const tested = data.events.flatMap((filter, index) => (isTested(filter) ? [typeFirst(filter, index)] : []));
  const testing = filterTestingOf(tested, sandbox);
  return {
    matchOf: ({ event, recordedAt }) => {
      const typed = data.events.filter(({ type }) => type === event.type);
      if (typed.some((filter) => !isTested(filter) && holdsLiterally(filter, event))) {
        return Effect.succeed(taken);
      }
      if (!typed.some((filter) => isTested(filter))) {
        return Effect.succeed(notTaken);
      }
      return Effect.map(
        Effect.promise(() => testing.verdictsOf(event, Date.parse(recordedAt))),
        matchOfVerdicts,
      );
    },
    close: testing.close,
  };
}
