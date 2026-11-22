import { GoalEventSchema, goalStream, type RecordedGoalEvent } from '@on.auto/definitions/goals';
import { streamPrefixOfDefinition, type Fold, type PlaybookAddress, type RecordedEvent } from '@on.auto/operations';
import { DeliveryFailed, type Consumer, type FollowedRecord } from '@on.auto/workflow-host';
import { Effect, Function } from 'effect';

import { noticeRunIdOf, type NoticeChange } from '../assessments/assessment-identity.ts';
import { goalsWantedIn, goalsWantedWith } from '../assessor/assessor.ts';
import { summarySeenIn, summarySeenRecorded, type SeenSummary } from '../summaries/summary-ledger.ts';
import { actingOf, noticeRecorded, type NoticeLedger } from './notice-ledger.ts';

const noticesSeenName = 'goal notices seen';

const noticesSeenSweeps = 20;

const changes: readonly NoticeChange[] = ['passed', 'failed', 'overdue'];

const runStream = /(?:^|\/)runs\/([^/]+)$/u;

const goalReference = /^goals\/([^/]+)\/assessments\/([0-9a-f-]{36})$/u;

interface Seen {
  readonly definition: string;
  readonly assessment: string;
  readonly change: NoticeChange;
  readonly run: string;
}

export function noticeSeenIn({ stream, context }: RecordedEvent): Seen | undefined {
  const { trigger } = context;
  const [, definition, assessment] = (trigger?.kind === 'goal' ? goalReference.exec(trigger.reference) : null) ?? [];
  const run = runStream.exec(stream)?.[1];
  if (definition === undefined || assessment === undefined || run === undefined) {
    return undefined;
  }
  const change = changes.find((asked) => noticeRunIdOf(assessment, asked) === run);
  return change === undefined ? undefined : { definition, assessment, change, run };
}

function placedAfter(placed: ReadonlySet<string>, fact: RecordedGoalEvent): ReadonlySet<string> {
  if (fact.type === 'goal_created') {
    return new Set([...placed, fact.data.playbook]);
  }
  return fact.type === 'goal_moved' ? new Set([...placed, fact.data.from, fact.data.to]) : placed;
}

const playbooksOfTheGoal: Fold<ReadonlySet<string>, RecordedGoalEvent> = {
  initialState: new Set(),
  evolve: placedAfter,
  eventSchema: GoalEventSchema,
};

function startedWhereTheGoalWas(
  ledger: NoticeLedger,
  { org, playbook }: PlaybookAddress,
  definition: string,
  recorded: Effect.Effect<void, unknown>,
): Effect.Effect<void, unknown> {
  const stream = `${streamPrefixOfDefinition({ org, definition })}${goalStream}`;
  return Effect.flatMap(ledger.load(stream, playbooksOfTheGoal), ({ state }) =>
    state.has(playbook) ? recorded : Effect.void,
  );
}

interface NoticeDelivery {
  readonly key: string;
  readonly workflow: string;
  readonly deliver: Effect.Effect<void, DeliveryFailed>;
  readonly skipped: () => Effect.Effect<void>;
}

function deliveryOf(
  ledger: NoticeLedger,
  { playbook, record }: Pick<FollowedRecord, 'playbook' | 'record'>,
  seen: Seen,
  now: () => number,
): NoticeDelivery {
  return {
    key: record.id,
    workflow: record.context.definitionName ?? noticesSeenName,
    deliver: Effect.suspend(() =>
      startedWhereTheGoalWas(
        ledger,
        playbook,
        seen.definition,
        noticeRecorded(ledger, { org: playbook.org, definition: seen.definition }, seen.assessment, {
          kind: 'seen',
          change: seen.change,
          run: seen.run,
          ...actingOf(playbook, now()),
        }),
      ),
    ).pipe(
      Effect.mapError(
        () => new DeliveryFailed({ detail: `The start of the notice ${seen.run} could not be recorded now` }),
      ),
    ),
    skipped: Function.constant(Effect.void),
  };
}

type Followed = Pick<FollowedRecord, 'playbook' | 'record'>;

function summaryDeliveryOf(
  ledger: NoticeLedger,
  { playbook, record }: Followed,
  seen: SeenSummary,
  now: () => number,
): NoticeDelivery {
  return {
    key: record.id,
    workflow: record.context.definitionName ?? noticesSeenName,
    deliver: Effect.suspend(() =>
      startedWhereTheGoalWas(ledger, playbook, seen.definition, summarySeenRecorded(ledger, playbook, seen, now())),
    ).pipe(
      Effect.mapError(
        () => new DeliveryFailed({ detail: `The start of the summary ${seen.run} could not be recorded now` }),
      ),
    ),
    skipped: Function.constant(Effect.void),
  };
}

function seenDeliveryOf(ledger: NoticeLedger, followed: Followed, now: () => number): NoticeDelivery | undefined {
  const notice = noticeSeenIn(followed.record);
  if (notice !== undefined) {
    return deliveryOf(ledger, followed, notice, now);
  }
  const summary = summarySeenIn(followed.record);
  return summary === undefined ? undefined : summaryDeliveryOf(ledger, followed, summary, now);
}

interface Batch {
  readonly deliveries: readonly NoticeDelivery[];
  readonly through: string | undefined;
  readonly more: boolean;
}

export interface NoticesSeen extends Consumer {
  readonly batchOf: (followed: Followed, after?: string) => Effect.Effect<Batch>;
  readonly wants: (playbookKey: string) => Effect.Effect<boolean>;
  readonly wantedWith: string;
}

export function noticesSeenOf(ledger: NoticeLedger, now: () => number): NoticesSeen {
  return {
    name: noticesSeenName,
    types: ['run_started'],
    skippedAfterSweeps: noticesSeenSweeps,
    wants: (playbookKey) => goalsWantedIn(ledger, playbookKey),
    wantedWith: goalsWantedWith,
    batchOf: (followed, after) => {
      const delivery = after === undefined ? seenDeliveryOf(ledger, followed, now) : undefined;
      return Effect.succeed({
        deliveries: delivery === undefined ? [] : [delivery],
        through: delivery === undefined ? undefined : followed.record.id,
        more: false,
      });
    },
  };
}
