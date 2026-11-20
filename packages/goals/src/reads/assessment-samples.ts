import type { Goal, HeldGoal } from '@on.auto/definitions/goals';
import { playbookLedgerOf, type PlaybookReader, PlaybookContext } from '@on.auto/operations';
import type { MemoryLedger } from '@on.auto/operations/testing';
import { Effect, type Schema } from 'effect';

import { goalIdentityOf, goalsMemoryLedger, goalsSavedBy } from '../assessor/assessor-ledger.ts';
import {
  afterSpan,
  appendingTo,
  instantText,
  observedData,
  openedDataOf,
  openingIdOf,
  refusedIn,
  thingsOf,
  type Observed,
  type Span,
} from './assessment-appends.ts';
import { runStartedByAnEventIn } from './run-samples.ts';

export { afterSpan, day, daySpan, instantText } from './assessment-appends.ts';

const sales = { org: 'acme', playbook: 'sales' };

const salesKey = 'playbook/acme/sales/';

export function heldGoalOf(goal: Goal, version = 1): HeldGoal {
  return { definition: goalIdentityOf(goal.id), version, goal };
}

export const firstDay = Date.parse('2026-11-02T00:00:00.000Z');

const milestones: NonNullable<Goal['milestones']> = [
  { id: 'chosen', label: 'Idea chosen', by: 'person' },
  { id: 'prepared', label: 'Package prepared', by: 'auto' },
  { id: 'live', label: 'Taken live', by: 'person' },
  { id: 'measured', label: 'Measured', by: 'auto' },
];

export const experimentsGoal: Goal = {
  id: 'paying-customers',
  statement: 'Bring in paying customers through my experiments.',
  per: 'experiment',
  window: { after: 'live', for: 'P7D', grace: 'P1D' },
  success: {
    label: 'New paying customers',
    settles: 'on_crossing',
    target: { at_least: 1 },
    passed: 'Brought a customer',
    failed: 'Brought no customer',
  },
  milestones,
  notify: { passed: 'now', failed: 'now', overdue: 'now', through: 'tell-owner' },
};

export const controlsGoal: Goal = {
  id: 'controls-hold',
  statement: 'Every control passes its daily check.',
  window: { calendar: 'day', grace: 'PT1H' },
  success: {
    label: 'Failing controls',
    settles: 'on_crossing',
    target: { at_most: 0 },
    passed: 'All controls held',
    failed: 'A control failed',
  },
  notify: { passed: 'quiet', failed: 'now', overdue: 'now', through: 'tell-owner' },
};

export const costGoal: Goal = {
  id: 'cost-per-lead',
  statement: 'Keep the cost of a lead at fifty or less each week.',
  window: { calendar: 'week', grace: 'PT8H' },
  success: {
    label: 'Cost per lead',
    settles: 'at_close',
    target: { at_most: 50 },
    passed: 'Within budget',
    failed: 'Over budget',
  },
  notify: {
    passed: 'summary',
    failed: 'summary',
    overdue: 'summary',
    summary: { cron: '0 9 * * 1' },
    through: 'tell-owner',
  },
};

export const oneOffGoal: Goal = {
  id: 'first-sale',
  statement: 'Make the first sale through the new shop.',
  success: {
    label: 'Sales',
    settles: 'on_crossing',
    target: { at_least: 1 },
    passed: 'Sold',
    failed: 'Not sold',
  },
  notify: { passed: 'now', failed: 'now', through: 'tell-owner' },
};

export interface AssessmentBook {
  readonly opened: (
    goal: Goal,
    at: number,
    thing?: { readonly per?: string; readonly window?: Span },
  ) => Promise<string>;
  readonly observed: (id: string, at: number, observed: Observed) => Promise<void>;
  readonly assessed: (
    id: string,
    verdict: 'passed' | 'failed',
    at: number,
    by?: 'crossing' | 'final' | 'deadline',
  ) => Promise<void>;
  readonly overdue: (id: string, since: number) => Promise<void>;
  readonly ended: (id: string, reason: 'no_result' | 'goal_retired' | 'playbook_retired', at: number) => Promise<void>;
  readonly stopped: (id: string, run: string, at: number, reason: string) => Promise<void>;
  readonly dismissed: (id: string, by: string, at: number, requests?: readonly string[]) => Promise<void>;
  readonly restored: (id: string, by: string, at: number) => Promise<void>;
  readonly noticeStarted: (id: string, change: 'passed' | 'failed' | 'overdue', at: number) => Promise<void>;
  readonly noticeEnded: (
    change: 'passed' | 'failed' | 'overdue',
    type: string,
    data: Schema.Json,
    at: number,
  ) => Promise<void>;
  readonly refused: (goal: string, workflow: string, at: number, detail?: string) => Promise<void>;
  readonly goalsSaved: (goals: readonly Goal[]) => Promise<void>;
  readonly runStartedByAnEvent: (run: string, cause: string, at: number) => Promise<void>;
  readonly inThePlaybook: <A>(work: Effect.Effect<A, never, PlaybookReader | PlaybookContext>) => Promise<A>;
  readonly ledger: MemoryLedger['layer'];
}

export function assessmentBookOf(): AssessmentBook {
  const { service, layer } = goalsMemoryLedger();
  const append = appendingTo(service);
  const { kept, toIt, dismissal } = thingsOf(append);
  let runs = 0;
  return {
    opened: async (goal, at, thing = {}) => {
      const id = openingIdOf(goal, thing);
      kept(id, { goal: goal.id, ...(thing.per === undefined ? {} : { per: thing.per }) });
      await toIt(id, { type: 'goal_assessment_opened', data: openedDataOf(goal, thing) }, at);
      return id;
    },
    observed: (id, at, observed) => {
      runs += 1;
      return toIt(id, { type: 'goal_observed', data: observedData(`run-${String(runs)}`, at, observed) }, at);
    },
    assessed: (id, verdict, at, by = 'crossing') =>
      toIt(id, { type: 'goal_assessed', data: { verdict, at: instantText(at), by, told: 'now' } }, at),
    overdue: (id, since) => toIt(id, { type: 'goal_overdue', data: { since: instantText(since), told: 'now' } }, since),
    ended: (id, reason, at) => toIt(id, { type: 'goal_assessment_ended', data: { reason } }, at),
    stopped: (id, run, at, reason) =>
      toIt(id, { type: 'goal_stopped', data: { run, at: instantText(at), reason } }, at),
    dismissed: (id, by, at, requests = []) => dismissal('goal_dismissed', { id, by, at, requests }),
    restored: (id, by, at) => dismissal('goal_restored', { id, by, at }),
    noticeStarted: (id, change, at) =>
      toIt(id, { type: 'goal_notice_started', data: { change, run: `notice-${change}` } }, at),
    noticeEnded: (change, type, data, at) => append(`${salesKey}runs/notice-${change}`, { type, data }, at),
    refused: refusedIn(append),
    runStartedByAnEvent: runStartedByAnEventIn(service),
    goalsSaved: goalsSavedBy(
      (stream, type, data, context) =>
        append(stream, { type, data, context: { by: 'person:owner', ...context } }, firstDay),
      sales,
    ),
    inThePlaybook: (work) =>
      Effect.runPromise(
        Effect.provideContext(Effect.provideService(work, PlaybookContext, sales), playbookLedgerOf(service, sales)),
      ),
    ledger: layer,
  };
}

export function inTurn<Item, Made>(
  items: readonly Item[],
  make: (item: Item, index: number) => Promise<Made>,
): Promise<readonly Made[]> {
  return items.reduce<Promise<readonly Made[]>>(
    async (made, item, index) => [...(await made), await make(item, index)],
    Promise.resolve([]),
  );
}

export interface Thing {
  readonly per: string;
  readonly at: number;
  readonly marked: readonly string[];
  readonly live: number;
}

export async function thingAt(book: AssessmentBook, { per, at, marked, live }: Thing): Promise<string> {
  const id = await book.opened(experimentsGoal, at, { per });
  await inTurn(marked, (marks, index) =>
    book.observed(id, at + index, {
      marks,
      title: `Experiment ${per}`,
      ...(marks === 'live' ? { window: afterSpan(live) } : {}),
    }),
  );
  return id;
}
