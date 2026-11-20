import {
  type Decided,
  type Decider,
  type PlaybookAddress,
  type ProjectedAddress,
  type ProjectedRow,
  type RecordedEvent,
} from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { summaryRunIdOf } from '../assessments/assessment-identity.ts';
import { textOf } from '../assessments/assessment-state.ts';
import {
  GoalSummaryEventSchema,
  summariesStreamId,
  summariesStreamOf,
  type GoalAddress,
  type RecordedGoalSummaryEvent,
} from '../goal-facts/goal-facts.ts';
import type { Instant } from '../goal-rules/goal-rule.ts';
import { clockKey, clocksName, goalClockIn } from '../goal-tables/clock-rows.ts';
import { summariesName } from '../goal-tables/summary-rows.ts';
import { actingOf, type NoticeLedger } from '../notices/notice-ledger.ts';

interface Acting {
  readonly at: string;
  readonly by: string;
}

interface SummarySeen extends Acting {
  readonly kind: 'seen';
  readonly due: Instant;
  readonly run: string;
  readonly firstSavedAt: Instant;
}

interface SummaryRefused extends Acting {
  readonly kind: 'refused';
  readonly due: Instant;
  readonly attempt: number;
  readonly detail: string;
  readonly retry_at?: string;
}

export type SummaryCommand = SummarySeen | SummaryRefused;

interface SummariesState {
  readonly lastDue?: Instant;
}

type Decisions = readonly Decided<RecordedGoalSummaryEvent>[];

function summariesAfter(state: SummariesState, event: RecordedGoalSummaryEvent): SummariesState {
  if (event.type !== 'goal_summary_started') {
    return state;
  }
  const due = Date.parse(event.data.due);
  return { lastDue: Math.max(due, state.lastDue ?? due) };
}

function isSent({ lastDue }: SummariesState, due: Instant): boolean {
  return lastDue !== undefined && lastDue >= due;
}

function seenFacts({ due, run, firstSavedAt }: SummarySeen, state: SummariesState): Decisions {
  if (isSent(state, due)) {
    return [];
  }
  const window = { from: textOf(state.lastDue ?? firstSavedAt), to: textOf(due) };
  return [{ type: 'goal_summary_started', data: { due: textOf(due), window, run } }];
}

function refusedFacts(command: SummaryRefused, state: SummariesState): Decisions {
  if (isSent(state, command.due)) {
    return [];
  }
  const { attempt, detail, retry_at } = command;
  const retry = retry_at === undefined ? {} : { retry_at };
  return [{ type: 'goal_notice_refused', data: { change: 'summary', attempt, detail, ...retry } }];
}

function summaryDeciderOf({
  definition,
}: GoalAddress): Decider<SummariesState, SummaryCommand, RecordedGoalSummaryEvent> {
  return {
    initialState: {},
    evolve: summariesAfter,
    eventSchema: GoalSummaryEventSchema,
    decide: (command, state) =>
      Result.succeed(command.kind === 'seen' ? seenFacts(command, state) : refusedFacts(command, state)),
    context: ({ at, by }) => ({ at, by, definitionId: definition }),
  };
}

export function summaryRecorded(
  ledger: NoticeLedger,
  goal: GoalAddress,
  command: SummaryCommand,
): Effect.Effect<void, unknown> {
  return Effect.asVoid(ledger.execute(summariesStreamOf(goal), summaryDeciderOf(goal), command));
}

function rowKeyed(ledger: NoticeLedger, projection: string, at: ProjectedAddress, key: string) {
  return Effect.map(
    ledger.readProjectedRows(projection, at, {
      where: [{ column: 'row_key', equals: key }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
    ([found]): ProjectedRow | undefined => found?.row,
  );
}

export function clockRowIn(ledger: NoticeLedger, at: ProjectedAddress) {
  return rowKeyed(ledger, clocksName, at, clockKey);
}

export function summaryRowIn(ledger: NoticeLedger, goal: GoalAddress) {
  return rowKeyed(ledger, summariesName, goal, summariesStreamId);
}

export interface SeenSummary {
  readonly definition: string;
  readonly due: Instant;
  readonly run: string;
}

export function summarySeenRecorded(
  ledger: NoticeLedger,
  address: PlaybookAddress,
  { definition, due, run }: SeenSummary,
  now: number,
): Effect.Effect<void, unknown> {
  const goal = { org: address.org, definition };
  return Effect.flatMap(clockRowIn(ledger, goal), (row) => {
    const clock = goalClockIn(row);
    return clock === undefined
      ? Effect.void
      : summaryRecorded(ledger, goal, {
          kind: 'seen',
          due,
          run,
          firstSavedAt: clock.first_saved_at,
          ...actingOf(address, now),
        });
  });
}

const runStream = /(?:^|\/)runs\/([^/]+)$/u;

const summaryReference = /^goals\/([^/]+)\/summaries\/([^/]+)$/u;

export function summaryReferenceOf(definition: string, due: Instant): string {
  return `goals/${definition}/summaries/${new Date(due).toISOString()}`;
}

export function summarySeenIn({ stream, context }: RecordedEvent): SeenSummary | undefined {
  const { trigger } = context;
  const [, definition, dueText] = (trigger?.kind === 'goal' ? summaryReference.exec(trigger.reference) : null) ?? [];
  const run = runStream.exec(stream)?.[1];
  const due = Date.parse(dueText ?? '');
  if (
    definition === undefined ||
    run === undefined ||
    !Number.isFinite(due) ||
    summaryRunIdOf(definition, due) !== run
  ) {
    return undefined;
  }
  return { definition, due, run };
}
