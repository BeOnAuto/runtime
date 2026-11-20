import { assessmentIdOf, noticeRunIdOf } from '@on.auto/goals';
import { chatDelivery } from '@on.auto/interaction/testing';
import { ContextSchema, Ledger, streamPrefixOfDefinition, type Decider } from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';

import type { HostRuntime } from '../../workflows/host-dependencies.ts';
import { inRuntime } from '../../workflows/in-runtime.ts';
import { leadGoalId } from '../settings/goals-kept.ts';
import { goalIdentityIn } from './goal-identities.ts';

const experiment = 'experiment-7';

export interface NoticedIds {
  readonly goal: string;
  readonly assessment: string;
  readonly passedRun: string;
}

function noticedIdsOf(goal: string): NoticedIds {
  const assessment = assessmentIdOf({ definition: goal, per: experiment });
  return { goal, assessment, passedRun: noticeRunIdOf(assessment, 'passed') };
}

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

function streamUnder(goal: string, stream: string): string {
  return `${streamPrefixOfDefinition({ org: 'acme', definition: goal })}${stream}`;
}

export function goalIdentityOf(runtime: HostRuntime, name: string): Promise<string> {
  return Effect.runPromise(
    inRuntime(
      runtime,
      Effect.flatMap(Effect.service(Ledger), (kept) => goalIdentityIn(kept, name)),
    ),
  );
}

interface Appended {
  readonly type: string;
  readonly data: Schema.Json;
  readonly at: number;
}

function appendedIn(runtime: HostRuntime, goal: string, stream: string, { type, data, at }: Appended): Promise<void> {
  const context = { at: new Date(at).toISOString(), by: 'playbook:alpha', definitionId: goal };
  return Effect.runPromise(
    inRuntime(
      runtime,
      Effect.flatMap(Effect.service(Ledger), (kept) =>
        Effect.asVoid(Effect.orDie(kept.execute(streamUnder(goal, stream), verbatim, { type, data, context }))),
      ),
    ),
  );
}

export async function factsIn(runtime: HostRuntime, goal: string, stream: string): Promise<readonly string[]> {
  const loaded = await Effect.runPromise(
    inRuntime(
      runtime,
      Effect.flatMap(Effect.service(Ledger), (kept) => kept.load(streamUnder(goal, stream), typesFold)),
    ),
  );
  return loaded.state;
}

export async function assessedIn(runtime: HostRuntime, told: string, at: number): Promise<NoticedIds> {
  const ids = noticedIdsOf(await goalIdentityOf(runtime, leadGoalId));
  const stream = `assessments/${ids.assessment}`;
  const opened = {
    goal_version: 1,
    per: { id: experiment },
    rule: { settles: 'on_crossing', target: { at_least: 1 } },
    milestones: [],
  };
  await appendedIn(runtime, ids.goal, stream, { type: 'goal_assessment_opened', data: opened, at });
  const verdict = { verdict: 'passed', at: new Date(at).toISOString(), by: 'crossing', told };
  await appendedIn(runtime, ids.goal, stream, { type: 'goal_assessed', data: verdict, at });
  return ids;
}
