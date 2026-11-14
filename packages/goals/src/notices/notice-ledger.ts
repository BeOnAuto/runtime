import {
  streamPrefixOfPlaybook,
  type Decided,
  type Decider,
  type Ledger,
  type PlaybookAddress,
} from '@on.auto/operations';
import type { StartFunction } from '@on.auto/workflow-host';
import { Effect, Result } from 'effect';

import type { NoticeChange } from '../assessments/assessment-identity.ts';
import { assessmentAfter, unopened, type AssessmentState } from '../assessments/assessment-state.ts';
import { AssessmentEventSchema, assessmentsKind, type RecordedAssessmentEvent } from '../goal-facts/goal-facts.ts';
import {
  dayLimitDetail,
  noStartsMade,
  startReleased,
  startReservedUnderTheLimit,
  type DayStart,
  type StartsMade,
} from '../notice-limits/notice-day-limit.ts';
import type { GoalLinkOf } from '../notice-links/goal-links.ts';
import type { NoticedPlaybookOf } from './noticed-playbooks.ts';

export type NoticeLedger = Ledger['Service'];

export interface NoticePorts {
  readonly ledger: NoticeLedger;
  readonly start: StartFunction;
  readonly playbookOf: NoticedPlaybookOf;
  readonly linkOf?: GoalLinkOf;
}

interface Acting {
  readonly at: string;
  readonly by: string;
}

interface NoticeSeen extends Acting {
  readonly kind: 'seen';
  readonly change: NoticeChange;
  readonly run: string;
}

interface NoticeRefused extends Acting {
  readonly kind: 'refused';
  readonly change: NoticeChange;
  readonly attempt: number;
  readonly detail: string;
  readonly retry_at?: string;
}

export type NoticeCommand = NoticeSeen | NoticeRefused;

type Decisions = readonly Decided<RecordedAssessmentEvent>[];

function seenFacts({ change, run }: NoticeSeen, state: AssessmentState): Decisions {
  const known = state.pinned !== undefined && !state.started.some((started) => started.change === change);
  return known ? [{ type: 'goal_notice_started', data: { change, run } }] : [];
}

function refusedFacts(command: NoticeRefused, state: AssessmentState): Decisions {
  if (!state.owed.some(({ change }) => change === command.change)) {
    return [];
  }
  const { change, attempt, detail, retry_at } = command;
  const retry = retry_at === undefined ? {} : { retry_at };
  return [{ type: 'goal_notice_refused', data: { change, attempt, detail, ...retry } }];
}

const noticeDecider: Decider<AssessmentState, NoticeCommand, RecordedAssessmentEvent> = {
  initialState: unopened,
  evolve: assessmentAfter,
  eventSchema: AssessmentEventSchema,
  decide: (command, state) =>
    Result.succeed(command.kind === 'seen' ? seenFacts(command, state) : refusedFacts(command, state)),
  context: ({ at, by }) => ({ at, by }),
};

function assessmentStreamOf(address: PlaybookAddress, assessment: string): string {
  return `${streamPrefixOfPlaybook(address)}${assessmentsKind}/${assessment}`;
}

export function actingOf({ playbook }: PlaybookAddress, now: number): Acting {
  return { at: new Date(now).toISOString(), by: `playbook:${playbook}` };
}

export function noticeRecorded(
  ledger: NoticeLedger,
  address: PlaybookAddress,
  assessment: string,
  command: NoticeCommand,
): Effect.Effect<void, unknown> {
  return Effect.asVoid(ledger.execute(assessmentStreamOf(address, assessment), noticeDecider, command));
}

export function runStartedIn(ledger: NoticeLedger, address: PlaybookAddress, run: string): Effect.Effect<boolean> {
  return Effect.map(
    Effect.orDie(
      ledger.readRecorded(
        address,
        { kind: 'run', run },
        { order: 'asc', limit: 1, types: ['run_started'], dataOf: [] },
      ),
    ),
    ({ records }) => records.length > 0,
  );
}

export interface CountedPorts extends NoticePorts {
  readonly starts: StartsMade;
}

export function countedPortsOf(ports: NoticePorts, starts: StartsMade = noStartsMade()): CountedPorts {
  return { ...ports, starts };
}

export function dayStartReleased(ports: CountedPorts, start: DayStart): Effect.Effect<void> {
  return Effect.sync(() => {
    startReleased(ports.starts, start);
  });
}

export function dayLimitRefusalIn(ports: CountedPorts, start: DayStart): Effect.Effect<string | undefined, unknown> {
  return Effect.map(startReservedUnderTheLimit(ports.ledger, ports.starts, start), (reserved) =>
    reserved ? undefined : dayLimitDetail(start.address, start.now),
  );
}
