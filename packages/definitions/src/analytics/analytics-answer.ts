import type { RunOutcomeGroup } from '@on.auto/operations';
import { Schema } from 'effect';

import { daysOf, type AnalyticsWindow } from './analytics-window.ts';

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const RunsSchema = Schema.Struct({
  total: Count.annotate({ description: 'The runs that ended: succeeded, failed or rejected' }),
  succeeded: Count.annotate({ description: 'The runs that succeeded' }),
  failed: Count.annotate({ description: 'The runs that failed' }),
  rejected: Count.annotate({ description: 'The runs that were rejected, those that were cancelled among them' }),
}).annotate({ description: 'How many runs ended, by how they ended; a run still going counts nowhere' });

const TokensSchema = Schema.Struct({
  input: Count.annotate({ description: 'The input tokens the models used' }),
  output: Count.annotate({ description: 'The output tokens the models used' }),
  cached: Count.annotate({ description: 'The part of input read from the model provider’s cache' }),
}).annotate({
  description:
    'The tokens used by the runs that recorded them, a rejected run included; 0 where no run recorded a number',
});

const DurationSchema = Schema.NullOr(
  Schema.Struct({
    p50: Count.annotate({ description: 'The median duration, in milliseconds' }),
    p95: Count.annotate({ description: 'The 95th percentile of the durations, in milliseconds' }),
  }),
).annotate({
  description:
    'Nearest-rank percentiles of how long the runs that succeeded or failed took, from start to end; null when none did',
});

const DaySchema = Schema.Struct({
  day: Schema.String.annotate({ description: 'The day in UTC, as YYYY-MM-DD' }),
  runs: RunsSchema,
  tokens: TokensSchema,
  duration_ms: DurationSchema,
});

const FunctionSchema = Schema.Struct({
  type: Schema.String.annotate({
    description: 'The type of the definition: reasoning, interaction, prediction, recall, computation or workflow',
  }),
  name: Schema.String.annotate({ description: 'The definition name' }),
  runs: Count.annotate({ description: 'How many of its runs ended' }),
});

export const PlaybookAnalyticsSchema = Schema.Struct({
  days: Count.annotate({ description: 'How many days the window holds' }),
  runs: RunsSchema,
  tokens: TokensSchema,
  duration_ms: DurationSchema,
  by_day: Schema.Array(DaySchema).annotate({
    description: 'Every day of the window, oldest first, one with no runs included',
  }),
  by_function: Schema.Array(FunctionSchema).annotate({
    description: 'The definitions that had runs end, the most runs first, then by type and name',
  }),
}).annotate({
  identifier: 'PlaybookAnalytics',
  description: 'What the runs of a playbook did over a window of days, counted by when each first started',
});

export type PlaybookAnalytics = typeof PlaybookAnalyticsSchema.Type;

type Runs = typeof RunsSchema.Type;

type Tokens = typeof TokensSchema.Type;

type Duration = typeof DurationSchema.Type;

const noRuns: Runs = { total: 0, succeeded: 0, failed: 0, rejected: 0 };

function addedRuns(runs: Runs, { status, runs: count }: RunOutcomeGroup): Runs {
  return status === 'started' ? runs : { ...runs, total: runs.total + count, [status]: runs[status] + count };
}

function runsOf(groups: readonly RunOutcomeGroup[]): Runs {
  return groups.reduce((runs, group) => addedRuns(runs, group), noRuns);
}

function inCodePointOrder(left: string, right: string): number {
  return left < right ? -1 : 1;
}

type FunctionRuns = PlaybookAnalytics['by_function'][number];

function mostRunsFirst(left: FunctionRuns, right: FunctionRuns): number {
  if (left.runs !== right.runs) {
    return right.runs - left.runs;
  }
  return left.type === right.type ? inCodePointOrder(left.name, right.name) : inCodePointOrder(left.type, right.type);
}

function tokensOf(groups: readonly RunOutcomeGroup[]): Tokens {
  return groups.reduce<Tokens>(
    (tokens, group) => ({
      input: tokens.input + group.inputTokens,
      output: tokens.output + group.outputTokens,
      cached: tokens.cached + group.cachedTokens,
    }),
    { input: 0, output: 0, cached: 0 },
  );
}

function atRank(sorted: readonly number[], percent: number): number {
  const rank = Math.ceil((percent * sorted.length) / 100);
  return Math.max(...sorted.slice(rank - 1, rank));
}

export function durationOf(durations: readonly number[]): Duration {
  const sorted = durations.toSorted((left, right) => left - right);
  return sorted.length === 0 ? null : { p50: atRank(sorted, 50), p95: atRank(sorted, 95) };
}

type Summary = Pick<PlaybookAnalytics, 'runs' | 'tokens' | 'duration_ms'>;

function summaryOf(groups: readonly RunOutcomeGroup[]): Summary {
  const ended = groups.filter(({ status }) => status !== 'started');
  return {
    runs: runsOf(groups),
    tokens: tokensOf(ended),
    duration_ms: durationOf(ended.flatMap(({ durations }) => durations)),
  };
}

function dayIn(
  byDay: ReadonlyMap<string, readonly RunOutcomeGroup[]>,
  day: string,
): PlaybookAnalytics['by_day'][number] {
  const { runs, tokens, duration_ms } = summaryOf(byDay.get(day) ?? []);
  return { day, runs, tokens, duration_ms };
}

function byFunction(groups: readonly RunOutcomeGroup[]): PlaybookAnalytics['by_function'] {
  const functions = new Map<string, FunctionRuns>();
  for (const group of groups) {
    const key = JSON.stringify([group.definitionType, group.name]);
    const ended = group.status === 'started' ? 0 : group.runs;
    functions.set(key, { type: group.definitionType, name: group.name, runs: (functions.get(key)?.runs ?? 0) + ended });
  }
  return [...functions.values()].filter(({ runs }) => runs > 0).toSorted((left, right) => mostRunsFirst(left, right));
}

export function analyticsOf(window: AnalyticsWindow, groups: readonly RunOutcomeGroup[]): PlaybookAnalytics {
  const byDay = Map.groupBy(groups, ({ day }) => day);
  return {
    days: window.days,
    ...summaryOf(groups),
    by_day: daysOf(window).map((day) => dayIn(byDay, day)),
    by_function: byFunction(groups),
  };
}
