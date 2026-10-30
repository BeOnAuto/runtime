import {
  enclosedBody,
  type FilterVerdict,
  type MatchedFilter,
  type PageFilters,
  type PageVerdicts,
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

export interface MatchedEvent {
  readonly placed: PageEvent;
  readonly match: EventMatch;
}

export interface DatasetMatching {
  readonly matchesOf: (events: readonly PageEvent[]) => Effect.Effect<readonly MatchedEvent[]>;
}

type Filter = DatasetData['events'][number];

const taken: EventMatch = { kind: 'taken' };

const notTaken: EventMatch = { kind: 'not_taken' };

const unjudged: EventMatch = {
  kind: 'stopped',
  detail: 'The filters that test the page were stopped before they judged this event',
};

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

type Literal = EventMatch | 'tested';

interface Placed {
  readonly placed: PageEvent;
  readonly literal: Literal;
}

function literalMatchOf(data: DatasetData, { event }: PageEvent): Literal {
  const typed = data.events.filter(({ type }) => type === event.type);
  if (typed.some((filter) => !isTested(filter) && holdsLiterally(filter, event))) {
    return taken;
  }
  return typed.some((filter) => isTested(filter)) ? 'tested' : notTaken;
}

function verdictMatchOf(verdicts: readonly FilterVerdict[] | undefined): EventMatch {
  return verdicts === undefined ? unjudged : matchOfVerdicts(verdicts);
}

function matchesUntilStopped(placings: readonly Placed[], verdicts: PageVerdicts): readonly MatchedEvent[] {
  const matched: MatchedEvent[] = [];
  let judged = 0;
  for (const { placed, literal } of placings) {
    const match = literal === 'tested' ? verdictMatchOf(verdicts[judged]) : literal;
    judged += literal === 'tested' ? 1 : 0;
    matched.push({ placed, match });
    if (match.kind === 'stopped') {
      break;
    }
  }
  return matched;
}

export function datasetMatchingOf(data: DatasetData, filters: PageFilters): DatasetMatching {
  const tested = data.events.flatMap((filter, index) => (isTested(filter) ? [typeFirst(filter, index)] : []));
  return {
    matchesOf: (events) => {
      const placings = events.map((placed): Placed => ({ placed, literal: literalMatchOf(data, placed) }));
      const judged = placings
        .filter(({ literal }) => literal === 'tested')
        .map(({ placed: { event, recordedAt } }) => ({ event, now: Date.parse(recordedAt) }));
      const verdicts =
        judged.length === 0
          ? Effect.succeed<PageVerdicts>([])
          : Effect.promise(() => filters.verdictsOf(tested, judged));
      return Effect.map(verdicts, (answered) => matchesUntilStopped(placings, answered));
    },
  };
}
