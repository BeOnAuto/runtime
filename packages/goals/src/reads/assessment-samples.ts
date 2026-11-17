import type { Goal } from '@on.auto/definitions/goals';
import {
  ContextSchema,
  playbookLedgerOf,
  type Decider,
  type PlaybookReader,
  PlaybookContext,
} from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Result, Schema } from 'effect';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import { goalsLedger } from '../engine/goals-engine.ts';
import { runStartedByAnEventIn } from './run-samples.ts';

const sales = { org: 'acme', playbook: 'sales' };

const salesKey = 'playbook/acme/sales/';

export const day = 86_400_000;

export const firstDay = Date.parse('2026-11-02T00:00:00.000Z');

export function instantText(instant: number): string {
  return new Date(instant).toISOString();
}

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

const FactSchema = Schema.Struct({ type: Schema.String, data: Schema.Json, context: ContextSchema });

type Fact = typeof FactSchema.Type;

const verbatim: Decider<null, Fact, Fact> = {
  initialState: null,
  evolve: () => null,
  decide: ({ type, data }) => Result.succeed([{ type, data }]),
  context: ({ context }) => context,
  eventSchema: FactSchema,
};

export interface Span {
  readonly opens: number;
  readonly closes: number;
  readonly due: number;
}

function spanText({ opens, closes, due }: Span) {
  return { opens: instantText(opens), closes: instantText(closes), due: instantText(due) };
}

export function afterSpan(live: number): Span {
  return { opens: live, closes: live + 7 * day, due: live + 8 * day };
}

export function daySpan(opens: number): Span {
  return { opens, closes: opens + day, due: opens + day + 3_600_000 };
}

interface Observed {
  readonly marks?: string;
  readonly measurement?: { readonly value: number; readonly final: boolean; readonly as_of: number };
  readonly title?: string;
  readonly link?: string;
  readonly says?: string;
  readonly window?: Span;
}

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
}

function windowOfData(window: Span | undefined) {
  return window === undefined ? {} : { window: spanText(window) };
}

function observedData(run: string, at: number, { measurement, window, ...words }: Observed) {
  return {
    source: { record: `record-${run}`, run, workflow: 'measure', version: 1, entry: 0 },
    at: instantText(at),
    ...words,
    ...(measurement === undefined
      ? {}
      : { measurement: { value: measurement.value, final: measurement.final, as_of: instantText(measurement.as_of) } }),
    ...windowOfData(window),
  };
}

type Append = (stream: string, type: string, data: Schema.Json, at: number) => Promise<void>;

interface Opening {
  readonly per?: string;
  readonly window?: Span;
}

function openingIdOf(goal: Goal, { per, window }: Opening): string {
  if (per !== undefined) {
    return assessmentIdOf({ goal: goal.id, per });
  }
  return assessmentIdOf({ goal: goal.id, ...(window === undefined ? {} : { window_start: window.opens }) });
}

function openedDataOf(goal: Goal, { per, window }: Opening) {
  return {
    goal: goal.id,
    goals_version: 1,
    ...(per === undefined ? {} : { per: { id: per } }),
    ...windowOfData(window),
    rule: {
      settles: goal.success.settles,
      target: goal.success.target,
      ...(goal.window === undefined ? {} : { window: goal.window }),
    },
    milestones: goal.milestones ?? [],
  };
}

function appendingTo(service: ReturnType<typeof memoryLedger>['service']): Append {
  return (stream, type, data, at) =>
    Effect.runPromise(
      Effect.asVoid(
        service.execute(`${salesKey}${stream}`, verbatim, {
          type,
          data,
          context: { at: instantText(at), by: 'playbook:sales' },
        }),
      ),
    );
}

const refusedOutput = '/contributes/0: The output at /customers is no finite number';

export function assessmentBookOf(): AssessmentBook {
  const { service } = memoryLedger(undefined, goalsLedger.projections);
  const append = appendingTo(service);
  let runs = 0;
  const toIt = (id: string, type: string, data: Schema.Json, at: number) => append(`assessments/${id}`, type, data, at);
  return {
    opened: async (goal, at, thing = {}) => {
      const id = openingIdOf(goal, thing);
      await toIt(id, 'goal_assessment_opened', openedDataOf(goal, thing), at);
      return id;
    },
    observed: (id, at, observed) => {
      runs += 1;
      return toIt(id, 'goal_observed', observedData(`run-${String(runs)}`, at, observed), at);
    },
    assessed: (id, verdict, at, by = 'crossing') =>
      toIt(id, 'goal_assessed', { verdict, at: instantText(at), by, told: 'now' }, at),
    overdue: (id, since) => toIt(id, 'goal_overdue', { since: instantText(since), told: 'now' }, since),
    ended: (id, reason, at) => toIt(id, 'goal_assessment_ended', { reason }, at),
    stopped: (id, run, at, reason) => toIt(id, 'goal_stopped', { run, at: instantText(at), reason }, at),
    noticeStarted: (id, change, at) => toIt(id, 'goal_notice_started', { change, run: `notice-${change}` }, at),
    noticeEnded: (change, type, data, at) => append(`runs/notice-${change}`, type, data, at),
    refused: (goal, workflow, at, detail = refusedOutput) =>
      append(
        `goal-refusals/${goal}.${workflow}`,
        'goal_observation_refused',
        { run: `refused-${String(at)}`, detail },
        at,
      ),
    runStartedByAnEvent: runStartedByAnEventIn(service),
    goalsSaved: (goals) =>
      append('goals/playbook', 'playbook_goals_saved', { source: 'goals', goals, version: 1 }, firstDay),
    inThePlaybook: (work) =>
      Effect.runPromise(
        Effect.provideContext(Effect.provideService(work, PlaybookContext, sales), playbookLedgerOf(service, sales)),
      ),
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
