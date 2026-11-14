import type { Goal } from '@on.auto/definitions/goals';
import type { ProjectedRow, RecordedCaller } from '@on.auto/operations';
import { Effect } from 'effect';

import { summaryRunIdOf } from '../assessments/assessment-identity.ts';
import { dayLimitRefusalIn, dayStartReleased, runStartedIn, type CountedPorts } from '../notices/notice-ledger.ts';
import { summaryInputOf } from './summary-input.ts';
import { summaryRowIn, summarySeenRecorded } from './summary-ledger.ts';
import { summarisedIn } from './summary-lines.ts';
import { refusedForNow, refusedOnce } from './summary-refusals.ts';
import { earlierDueOf, seenWaitOf, type Moment, type Summary } from './summary-times.ts';

function numberOf(row: ProjectedRow | undefined, column: string): number | undefined {
  const value = row?.[column];
  return typeof value === 'number' ? value : undefined;
}

interface Starting {
  readonly goal: Goal;
  readonly run: string;
  readonly attempt: number;
  readonly owner: RecordedCaller;
}

function startedUnderTheLimit(
  ports: CountedPorts,
  summary: Summary,
  through: string,
  { goal, run, attempt, owner }: Starting,
): Effect.Effect<Moment, unknown> {
  const { address, clock, due } = summary;
  const window = { from: clock.last_summary ?? clock.first_saved_at, to: due };
  const link = ports.linkOf?.({ playbook: address.playbook, goal: goal.id });
  return Effect.flatMap(
    summarisedIn({ ledger: ports.ledger, address, goal: goal.id, window, linkOf: ports.linkOf }),
    ({ assessments, counts }) =>
      ports
        .start({
          org: address.org,
          playbook: address.playbook,
          type: 'interaction',
          name: through,
          runId: run,
          input: { ...summaryInputOf({ goal, window, assessments, counts, owner, link }) },
          trigger: { kind: 'goal', reference: `goals/${goal.id}/summaries/${new Date(due).toISOString()}` },
        })
        .pipe(
          Effect.as<Moment>(summary.now + seenWaitOf(summary)),
          Effect.tapError(() => dayStartReleased(ports, { address, run, now: summary.now })),
          Effect.catchTags({
            start_refused: ({ detail }: { readonly detail: string }) =>
              refusedForNow(ports, summary, attempt + 1, `The function ${through} could not be started now: ${detail}`),
            start_rejected: ({ detail }: { readonly detail: string }) =>
              refusedOnce(ports, summary, attempt, `The function ${through} refused the summary: ${detail}`),
          }),
        ),
  );
}

function startedNow(
  ports: CountedPorts,
  summary: Summary,
  owner: RecordedCaller | undefined,
  { goal, run, attempt }: Omit<Starting, 'owner'>,
): Effect.Effect<Moment, unknown> {
  const through = goal.notify?.summary?.through ?? goal.notify?.through;
  if (through === undefined) {
    return refusedOnce(ports, summary, attempt, `The goal ${goal.id} names no notification function for its summary`);
  }
  if (owner === undefined) {
    return refusedForNow(
      ports,
      summary,
      attempt + 1,
      `The owner of the playbook ${summary.address.playbook} could not be read now`,
    );
  }
  return Effect.flatMap(dayLimitRefusalIn(ports, { address: summary.address, run, now: summary.now }), (limit) =>
    limit === undefined
      ? startedUnderTheLimit(ports, summary, through, { goal, run, attempt, owner })
      : refusedOnce(ports, summary, attempt, limit),
  );
}

function afterAnEarlierStart(ports: CountedPorts, summary: Summary): Effect.Effect<Summary, unknown> {
  const { address, clock, now } = summary;
  const earlier = earlierDueOf(summary);
  if (earlier === undefined) {
    return Effect.succeed(summary);
  }
  const run = summaryRunIdOf(clock.id, earlier);
  return Effect.flatMap(runStartedIn(ports.ledger, address, run), (seen) =>
    seen
      ? Effect.as(summarySeenRecorded(ports.ledger, address, { goal: clock.id, due: earlier, run }, now), {
          ...summary,
          clock: { ...clock, last_summary: earlier },
        })
      : Effect.succeed(summary),
  );
}

function dueAfterEarlier(
  ports: CountedPorts,
  summary: Summary,
  goal: Goal,
  owner: RecordedCaller | undefined,
): Effect.Effect<Moment, unknown> {
  const { address, clock, due, now } = summary;
  const run = summaryRunIdOf(clock.id, due);
  return Effect.flatMap(summaryRowIn(ports.ledger, address, clock.id), (row) => {
    const refusedAt = numberOf(row, 'refused_at');
    const standing = refusedAt !== undefined && refusedAt >= due ? numberOf(row, 'attempt') : undefined;
    const retryAt = numberOf(row, 'retry_at');
    if (standing !== undefined && retryAt === undefined) {
      return Effect.succeed<Moment>(null);
    }
    if (standing !== undefined && retryAt !== undefined && retryAt > now) {
      return Effect.succeed<Moment>(retryAt);
    }
    const attempt = standing ?? 0;
    return startedNow(ports, summary, owner, { goal, run, attempt });
  });
}

export function summaryDue(
  ports: CountedPorts,
  summary: Summary,
  goal: Goal,
  owner: RecordedCaller | undefined,
): Effect.Effect<Moment, unknown> {
  const { address, clock, due, now } = summary;
  const run = summaryRunIdOf(clock.id, due);
  return Effect.flatMap(runStartedIn(ports.ledger, address, run), (seen) => {
    if (seen) {
      return Effect.as(summarySeenRecorded(ports.ledger, address, { goal: clock.id, due, run }, now), null);
    }
    return Effect.flatMap(afterAnEarlierStart(ports, summary), (after) => dueAfterEarlier(ports, after, goal, owner));
  });
}
