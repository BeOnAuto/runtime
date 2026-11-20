import type { Goal } from '@on.auto/definitions/goals';
import type { Context } from '@on.auto/operations';
import type { MemoryLedger } from '@on.auto/operations/testing';
import { Effect, type Schema } from 'effect';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import { goalIdentityOf } from '../assessor/assessor-ledger.ts';
import { verbatim } from './run-samples.ts';

export const day = 86_400_000;

export function instantText(instant: number): string {
  return new Date(instant).toISOString();
}

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

export interface Observed {
  readonly marks?: string;
  readonly measurement?: { readonly value: number; readonly final: boolean; readonly as_of: number };
  readonly title?: string;
  readonly link?: string;
  readonly says?: string;
  readonly window?: Span;
}

function windowOfData(window: Span | undefined) {
  return window === undefined ? {} : { window: spanText(window) };
}

export function observedData(run: string, at: number, { measurement, window, ...words }: Observed) {
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

interface Fact {
  readonly type: string;
  readonly data: Schema.Json;
  readonly context?: Partial<Context>;
}

export type Append = (stream: string, fact: Fact, at: number) => Promise<void>;

export interface Opening {
  readonly per?: string;
  readonly window?: Span;
}

export function openingIdOf(goal: Goal, { per, window }: Opening): string {
  const definition = goalIdentityOf(goal.id);
  if (per !== undefined) {
    return assessmentIdOf({ definition, per });
  }
  return assessmentIdOf({ definition, ...(window === undefined ? {} : { window_start: window.opens }) });
}

export function openedDataOf(goal: Goal, { per, window }: Opening) {
  return {
    goal_version: 1,
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

function goalKeyOf(goal: string): string {
  return `definition/acme/${goalIdentityOf(goal)}/`;
}

export function appendingTo(service: MemoryLedger['service']): Append {
  return (stream, { type, data, context = {} }, at) =>
    Effect.runPromise(
      Effect.asVoid(
        service.execute(stream, verbatim, {
          type,
          data,
          context: { at: instantText(at), by: 'playbook:sales', ...context },
        }),
      ),
    );
}

interface ThingOfAGoal {
  readonly goal: string;
  readonly per?: string;
}

interface Dismissing {
  readonly id: string;
  readonly by: string;
  readonly at: number;
  readonly requests?: readonly string[];
}

interface Things {
  readonly kept: (id: string, thing: ThingOfAGoal) => void;
  readonly toIt: (id: string, fact: Fact, at: number) => Promise<void>;
  readonly dismissal: (type: 'goal_dismissed' | 'goal_restored', dismissing: Dismissing) => Promise<void>;
}

type Kept = readonly [string, ThingOfAGoal];

export function thingsOf(append: Append): Things {
  const things = new Map<string, ThingOfAGoal>();
  const goalOf = (id: string) =>
    [...things]
      .filter(([key]: Kept) => key === id)
      .map(([, { goal }]: Kept) => goal)
      .join('');
  const toIt = (id: string, { context, ...fact }: Fact, at: number) => {
    const goal = goalOf(id);
    return append(
      `${goalKeyOf(goal)}assessments/${id}`,
      { ...fact, context: { definitionId: goalIdentityOf(goal), ...context } },
      at,
    );
  };
  return {
    kept: (id, thing) => {
      things.set(id, thing);
    },
    toIt,
    dismissal: (type, { id, by, at, requests }) => {
      const per = things.get(id)?.per;
      const data = { ...(per === undefined ? {} : { per }), at: instantText(at), by: { id: by, name: by } };
      return toIt(
        id,
        {
          type,
          data: requests === undefined ? data : { ...data, requests: [...requests] },
          context: { definitionName: goalOf(id) },
        },
        at,
      );
    },
  };
}

const refusedOutput = '/contributes/0: The output at /customers is no finite number';

export function refusedIn(append: Append) {
  return (goal: string, workflow: string, at: number, detail = refusedOutput) =>
    append(
      `${goalKeyOf(goal)}goal-refusals/${workflow}`,
      {
        type: 'goal_observation_refused',
        data: { run: `refused-${String(at)}`, detail },
        context: { definitionId: goalIdentityOf(goal) },
      },
      at,
    );
}
