import { withinDetailBytes, type Goal } from '@on.auto/definitions/goals';
import { PlaybookReader } from '@on.auto/operations';
import type { GoalGap } from '@on.auto/playbooks';
import { Effect, Option, Schema } from 'effect';

import { NoticesStartedSchema, type NoticesStarted } from '../goal-tables/assessment-row-state.ts';

export type StartedNotice = NoticesStarted[number];

export interface DeliveredNotice extends StartedNotice {
  readonly delivered?: boolean;
}

interface NoticeEnding {
  readonly delivered: boolean;
  readonly how: string;
}

const endingTypes: readonly string[] = ['run_succeeded', 'run_rejected', 'run_failed'];

const RejectedSchema = Schema.Struct({ rejection: Schema.Struct({ detail: Schema.String }) });

const rejectedOf = Schema.decodeUnknownOption(RejectedSchema);

const noticesOfText = Schema.decodeUnknownOption(NoticesStartedSchema);

function endingOf(type: string, data: unknown): NoticeEnding {
  if (type === 'run_succeeded') {
    return { delivered: true, how: 'it was delivered' };
  }
  if (type === 'run_failed') {
    return { delivered: false, how: 'its run failed' };
  }
  return {
    delivered: false,
    how: Option.match(rejectedOf(data), {
      onNone: () => 'its run was rejected',
      onSome: ({ rejection }) => `its run was rejected: ${rejection.detail}`,
    }),
  };
}

function noticeEndingIn(run: string): Effect.Effect<NoticeEnding | undefined, never, PlaybookReader> {
  return PlaybookReader.use((reader) =>
    Effect.map(
      Effect.orDie(
        reader.readRecorded(
          { kind: 'run', run },
          { order: 'desc', limit: 1, types: endingTypes, dataOf: ['run_rejected'] },
        ),
      ),
      ({ records }) => {
        const [ending] = records;
        return ending === undefined ? undefined : endingOf(ending.type, ending.data);
      },
    ),
  );
}

export function noticesDeliveredIn(
  notices: readonly StartedNotice[],
): Effect.Effect<readonly DeliveredNotice[], never, PlaybookReader> {
  return Effect.forEach(notices, (notice) =>
    Effect.map(noticeEndingIn(notice.run), (ending): DeliveredNotice =>
      ending === undefined ? notice : { ...notice, delivered: ending.delivered },
    ),
  );
}

export function messageSaying(goal: string, change: string): string {
  return `The message saying the goal ${goal} ${change === 'overdue' ? 'became overdue' : change}`;
}

export function noticeUndeliveredGap({ id, notify }: Goal, { change }: StartedNotice, how: string): GoalGap {
  const through = notify?.through ?? 'its notification function';
  return {
    kind: 'notice_undelivered',
    goal: id,
    detail: withinDetailBytes(
      `${messageSaying(id, change)} was not delivered: ${how}. Check the connection, the address and the expiry of ${through} (an hour at least).`,
    ),
    fixed_by: 'agent',
  };
}

export function newestNoticeOf(text: unknown): StartedNotice | undefined {
  const notices = Option.getOrElse(noticesOfText(text), () => []);
  return notices.toSorted((one, other) => Date.parse(one.at) - Date.parse(other.at)).at(-1);
}

export function undeliveredGapsOf(
  goal: Goal,
  notice: StartedNotice | undefined,
): Effect.Effect<readonly GoalGap[], never, PlaybookReader> {
  if (notice === undefined) {
    return Effect.succeed([]);
  }
  return Effect.map(noticeEndingIn(notice.run), (ending) =>
    ending === undefined || ending.delivered ? [] : [noticeUndeliveredGap(goal, notice, ending.how)],
  );
}
