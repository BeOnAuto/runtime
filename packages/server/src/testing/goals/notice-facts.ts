import { assessmentIdOf, noticeRunIdOf } from '@on.auto/goals';
import { chatDelivery } from '@on.auto/interaction/testing';
import { ContextSchema, Ledger, type Decider } from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';

import type { HostRuntime } from '../../workflows/host-dependencies.ts';
import { inRuntime } from '../../workflows/in-runtime.ts';
import { leadGoalId } from '../settings/goals-kept.ts';

const experiment = 'experiment-7';

export const assessment = assessmentIdOf({ goal: leadGoalId, per: experiment });

export const passedRun = noticeRunIdOf(assessment, 'passed');

export const noticeHeadline = 'Brought a customer: Bring in paying customers through my experiments.';

export const tellOwner = [
  '---',
  "to: '{{ input.owner.name }}'",
  'expires: PT4H',
  ...chatDelivery,
  '---',
  '{{ input.headline }}',
].join('\n');

const FactSchema = Schema.Struct({ type: Schema.String, data: Schema.Json, context: ContextSchema });

type Fact = typeof FactSchema.Type;

const verbatim: Decider<null, Fact, Fact> = {
  initialState: null,
  evolve: () => null,
  decide: ({ type, data }) => Result.succeed([{ type, data }]),
  context: ({ context }) => context,
  eventSchema: FactSchema,
};

const typesFold = {
  initialState: [],
  evolve: (types: readonly string[], { type }: Fact) => [...types, type],
  eventSchema: FactSchema,
};

const alphaStreams = 'playbook/acme/alpha/';

export function appendedIn(
  runtime: HostRuntime,
  stream: string,
  { type, data, at }: { readonly type: string; readonly data: Schema.Json; readonly at: number },
): Promise<void> {
  const context = { at: new Date(at).toISOString(), by: 'playbook:alpha' };
  return Effect.runPromise(
    inRuntime(
      runtime,
      Effect.flatMap(Effect.service(Ledger), (kept) =>
        Effect.asVoid(Effect.orDie(kept.execute(`${alphaStreams}${stream}`, verbatim, { type, data, context }))),
      ),
    ),
  );
}

export async function factsIn(runtime: HostRuntime, stream: string): Promise<readonly string[]> {
  const loaded = await Effect.runPromise(
    inRuntime(
      runtime,
      Effect.flatMap(Effect.service(Ledger), (kept) => kept.load(`${alphaStreams}${stream}`, typesFold)),
    ),
  );
  return loaded.state;
}

export async function assessedIn(runtime: HostRuntime, told: string, at: number, goal: string): Promise<void> {
  const lead = goal === leadGoalId;
  const stream = `assessments/${lead ? assessment : assessmentIdOf({ goal })}`;
  const opened = {
    goal,
    goals_version: 1,
    ...(lead ? { per: { id: experiment } } : {}),
    rule: { settles: 'on_crossing', target: { at_least: 1 } },
    milestones: [],
  };
  await appendedIn(runtime, stream, { type: 'goal_assessment_opened', data: opened, at });
  const verdict = { verdict: 'passed', at: new Date(at).toISOString(), by: 'crossing', told };
  await appendedIn(runtime, stream, { type: 'goal_assessed', data: verdict, at });
}
