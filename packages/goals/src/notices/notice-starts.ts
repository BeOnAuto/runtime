import { playbookGoalsIn, withinDetailBytes, type Goal } from '@on.auto/definitions/goals';
import {
  playbookLedgerOf,
  playbookRowsOf,
  type PlaybookAddress,
  type PlaybookProjectedRow,
  type RecordedCaller,
} from '@on.auto/operations';
import type { DueItem, DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import { noticeRunIdOf, type NoticeChange } from '../assessments/assessment-identity.ts';
import type { AssessmentState, OwedNotice } from '../assessments/assessment-state.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { advancedPast, noticeDueColumn, retiredHeld, rowStateOf, type Moment } from './notice-advances.ts';
import { noticeInputOf } from './notice-input.ts';
import {
  actingOf,
  countedPortsOf,
  dayLimitRefusalIn,
  dayStartReleased,
  noticeRecorded,
  runStartedIn,
  type CountedPorts,
  type NoticePorts,
} from './notice-ledger.ts';

const noticesOwedName = 'the notices of goals owed';

export const mostNoticeAttempts = 6;

const firstNoticeRetryMs = 60_000;

export const seenWaitMs = 60_000;

export const mostSeenWaitMs = 86_400_000;

interface Owing {
  readonly address: PlaybookAddress;
  readonly assessment: string;
  readonly state: AssessmentState;
  readonly owed: OwedNotice;
  readonly owner: RecordedCaller | undefined;
  readonly now: number;
}

interface Refusal {
  readonly detail: string;
}

function refusedOnce(ports: NoticePorts, owing: Owing, detail: string): Effect.Effect<Moment, unknown> {
  const { address, assessment, owed, now } = owing;
  return Effect.as(
    noticeRecorded(ports.ledger, address, assessment, {
      kind: 'refused',
      change: owed.change,
      attempt: owed.attempt + 1,
      detail: withinDetailBytes(detail),
      ...actingOf(address, now),
    }),
    null,
  );
}

export function retryDelayOf(attempt: number): number {
  return firstNoticeRetryMs * 2 ** (attempt - 1);
}

function refusedForNow(ports: NoticePorts, owing: Owing, detail: string): Effect.Effect<Moment, unknown> {
  const { address, assessment, owed, now } = owing;
  const attempt = owed.attempt + 1;
  if (attempt >= mostNoticeAttempts) {
    return refusedOnce(ports, owing, `${detail}; it was tried ${String(attempt)} times and is not tried again`);
  }
  const retryAt = now + retryDelayOf(attempt);
  return Effect.as(
    noticeRecorded(ports.ledger, address, assessment, {
      kind: 'refused',
      change: owed.change,
      attempt,
      detail: withinDetailBytes(detail),
      retry_at: new Date(retryAt).toISOString(),
      ...actingOf(address, now),
    }),
    retryAt,
  );
}

function seenOnce(ports: NoticePorts, owing: Owing, run: string): Effect.Effect<Moment, unknown> {
  const { address, assessment, owed, now } = owing;
  return Effect.as(
    noticeRecorded(ports.ledger, address, assessment, {
      kind: 'seen',
      change: owed.change,
      run,
      ...actingOf(address, now),
    }),
    null,
  );
}

export function seenWaitOf({ owed, now }: Pick<Owing, 'owed' | 'now'>): number {
  return Math.min(Math.max(seenWaitMs, now - owed.due), mostSeenWaitMs);
}

function goalOf(ports: NoticePorts, address: PlaybookAddress, id: string): Effect.Effect<Goal | undefined> {
  return Effect.map(Effect.provideContext(playbookGoalsIn, playbookLedgerOf(ports.ledger, address)), ({ goals }) =>
    goals.find((goal) => goal.id === id && goal.retired !== true),
  );
}

function startedNow(ports: CountedPorts, owing: Owing, goal: Goal, run: string): Effect.Effect<Moment, unknown> {
  const { address, owner, now } = owing;
  const through = goal.notify?.through;
  if (through === undefined) {
    return refusedOnce(ports, owing, `The goal ${goal.id} names no notification function in notify.through`);
  }
  if (owner === undefined) {
    return refusedForNow(ports, owing, `The owner of the playbook ${address.playbook} could not be read now`);
  }
  return Effect.flatMap(dayLimitRefusalIn(ports, { address, run, now }), (refusal) =>
    refusal === undefined
      ? startedUnderTheLimit(ports, owing, { goal, through, run, owner })
      : refusedOnce(ports, owing, refusal),
  );
}

interface Starting {
  readonly goal: Goal;
  readonly through: string;
  readonly run: string;
  readonly owner: RecordedCaller;
}

function linkOf(ports: NoticePorts, { address, state }: Owing, goal: Goal): string | undefined {
  const per = state.pinned?.per;
  return ports.linkOf?.({ playbook: address.playbook, goal: goal.id, ...(per === undefined ? {} : { per }) });
}

function startedUnderTheLimit(
  ports: CountedPorts,
  owing: Owing,
  { goal, through, run, owner }: Starting,
): Effect.Effect<Moment, unknown> {
  const { address, assessment, state, owed, now } = owing;
  const input = noticeInputOf({ goal, state, change: owed.change, owner, link: linkOf(ports, owing, goal) });
  const started = ports.start({
    org: address.org,
    playbook: address.playbook,
    type: 'interaction',
    name: through,
    runId: run,
    input: { ...input },
    trigger: { kind: 'goal', reference: `goals/${goal.id}/assessments/${assessment}` },
  });
  return started.pipe(
    Effect.as<Moment>(now + seenWaitOf(owing)),
    Effect.tapError(() => dayStartReleased(ports, { address, run, now })),
    Effect.catchTags({
      start_refused: ({ detail }: Refusal) =>
        refusedForNow(ports, owing, `The function ${through} could not be started now: ${detail}`),
      start_rejected: ({ detail }: Refusal) =>
        refusedOnce(ports, owing, `The function ${through} refused the message: ${detail}`),
    }),
  );
}

function noticeOwed(ports: CountedPorts, owing: Owing): Effect.Effect<Moment, unknown> {
  const { address, assessment, state, owed } = owing;
  const run = noticeRunIdOf(assessment, owed.change);
  return Effect.flatMap(runStartedIn(ports.ledger, address, run), (seen) => {
    if (seen) {
      return seenOnce(ports, owing, run);
    }
    const goal = state.pinned?.goal ?? '';
    return Effect.flatMap(goalOf(ports, address, goal), (kept) =>
      kept === undefined
        ? refusedOnce(ports, owing, `The goal ${goal} is retired or gone, so it sends nothing`)
        : startedNow(ports, owing, kept, run),
    );
  });
}

function changeAnswered(ports: CountedPorts, owing: Owing): Effect.Effect<readonly [NoticeChange, Moment], unknown> {
  return Effect.map(noticeOwed(ports, owing), (moment): readonly [NoticeChange, Moment] => [owing.owed.change, moment]);
}

function noticesPerformed(ports: CountedPorts, owing: PlaybookProjectedRow, now: number) {
  const { org, playbook, key, row } = owing;
  const address = { org, playbook };
  const state = rowStateOf(row);
  const owedNow = state.owed.filter(({ due }) => due <= now);
  if (owedNow.length === 0) {
    return advancedPast(ports, owing, new Map(), { now });
  }
  return Effect.flatMap(ports.playbookOf(address), ({ status, owner }) =>
    status === 'active'
      ? Effect.flatMap(
          Effect.forEach(owedNow, (owed) =>
            changeAnswered(ports, { address, assessment: key, state, owed, owner, now }),
          ),
          (answers: readonly (readonly [NoticeChange, Moment])[]) =>
            advancedPast(ports, owing, new Map(answers), { now }),
        )
      : retiredHeld(ports, owing, now),
  );
}

function itemOf(ports: CountedPorts, owing: PlaybookProjectedRow): DueItem {
  return {
    key: `${owing.org}/${owing.playbook}/${owing.key}`,
    callsOut: false,
    perform: (now) => Effect.suspend(() => noticesPerformed(ports, owing, now)),
  };
}

const nothingDue: readonly DueItem[] = [];

export function noticesOwedOf(noticePorts: NoticePorts, starts?: CountedPorts['starts']): DueWork {
  const ports = countedPortsOf(noticePorts, starts);
  return {
    name: noticesOwedName,
    due: (now, most, callsOut) =>
      callsOut
        ? Effect.succeed(nothingDue)
        : Effect.map(
            ports.ledger.readDueRows(assessmentsName, { column: noticeDueColumn, through: now, limit: most }),
            (rows) => playbookRowsOf(assessmentsName, rows).map((owing) => itemOf(ports, owing)),
          ),
    nextDueAt: (after, callsOut = false) =>
      callsOut ? Effect.succeed(null) : ports.ledger.nextDueOf(assessmentsName, noticeDueColumn, after),
  };
}
