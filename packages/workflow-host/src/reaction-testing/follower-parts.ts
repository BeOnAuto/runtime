import { Effect, Function } from 'effect';

import type { PartsOptions } from '../host/host-parts.ts';
import type { HostNote } from '../host/host-reports.ts';
import { testMachine } from '../testing/host-documents.ts';
import { recordingReports, recordingSettlements } from '../testing/recording-reports.ts';
import { recordedWaiting } from '../waiting-testing/recorded-waiting.ts';
import { recordedReactions, unreadWhile } from './recorded-reactions.ts';

export interface FollowerPartsOf {
  readonly options: PartsOptions;
  readonly notes: () => readonly HostNote[];
  readonly troubles: () => readonly string[];
  readonly starts: () => readonly string[];
}

export interface MovingTime {
  readonly now: () => number;
  readonly moved: (milliseconds: number) => void;
}

export interface Trying {
  readonly unread: Readonly<{ now: boolean }>;
  readonly takesMs: Readonly<{ now: number }>;
}

export function followerPartsOf(time: MovingTime, { unread, takesMs }: Trying): FollowerPartsOf {
  const reports = recordingReports();
  const unreadNow = unreadWhile(unread);
  const reactions = recordedReactions({
    failure: (start) => {
      time.moved(takesMs.now);
      return unreadNow(start);
    },
  });
  return {
    options: {
      machine: testMachine,
      perform: Function.constant(Effect.succeed({ status: 'succeeded', output: null })),
      settle: recordingSettlements(Function.constFalse).settle,
      reports: reports.reports,
      sweepEveryMs: 1000,
      mostCallsAtOnce: 4,
      reactions: reactions.options,
      waiting: recordedWaiting().options,
      clock: { now: time.now, sleep: Effect.sleep },
      closesEndedRuns: false,
    },
    notes: reports.notes,
    troubles: reports.troubles,
    starts: () => reactions.starts().map(({ cause }) => cause),
  };
}
