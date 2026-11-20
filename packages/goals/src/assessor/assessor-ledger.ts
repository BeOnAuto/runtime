import { definitionTypeOrder } from '@on.auto/definitions';
import { definitionAndGoalNamesOf } from '@on.auto/definitions/identity';
import {
  ContextSchema,
  type Context,
  type Decider,
  type Fold,
  type Ledger,
  type PlaybookAddress,
  type ProjectedRow,
  type ProjectedRowsQuery,
  type RecordedEvent,
} from '@on.auto/operations';
import { memoryLedgerWith } from '@on.auto/operations/testing';
import type { Consumer, FollowedRecord } from '@on.auto/workflow-host';
import { Effect, Result, Schema } from 'effect';

import { goalsLedger } from '../engine/goals-engine.ts';

export const sales = { org: 'acme', playbook: 'sales' };

export const salesKey = 'playbook/acme/sales/';

export const monday = Date.parse('2026-11-09T09:00:00.000Z');

const FactSchema = Schema.Struct({ type: Schema.String, data: Schema.Json, context: ContextSchema });

type Fact = typeof FactSchema.Type;

const verbatim: Decider<null, Fact, Fact> = {
  initialState: null,
  evolve: () => null,
  decide: ({ type, data }) => Result.succeed([{ type, data }]),
  context: ({ context }) => context,
  eventSchema: FactSchema,
};

const typesFold: Fold<readonly string[], Fact> = {
  initialState: [],
  evolve: (types, { type }) => [...types, type],
  eventSchema: FactSchema,
};

const allOf: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 1000 };

export const experiments = {
  id: 'paying-customers',
  statement: 'Bring in paying customers through my experiments.',
  per: 'experiment',
  success: {
    label: 'New paying customers',
    settles: 'on_crossing',
    target: { at_least: 1 },
    passed: 'Brought a customer',
    failed: 'Brought no customer',
  },
  notify: { passed: 'now', failed: 'now', through: 'tell-owner' },
};

export const controls = {
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

export function goalIdentityOf(id: string): string {
  return `goal-of-${id}`;
}

type Appending = (stream: string, type: string, data: Schema.Json, context: Partial<Context>) => Promise<void>;

export type GoalsSaving = (goals: Schema.Json, at?: string) => Promise<void>;

const listedOf = Schema.decodeUnknownSync(Schema.Array(Schema.Json));

const idOf = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));

export function goalsSavedBy(appendedTo: Appending, { org, playbook }: PlaybookAddress): GoalsSaving {
  const held = new Map<string, string>();
  const savedOne = (goal: Schema.Json, position: number, at: string | undefined): Promise<void> => {
    const { id } = idOf(goal);
    const definition = goalIdentityOf(id);
    const stream = `definition/${org}/${definition}/goals/goal`;
    const context = { ...(at === undefined ? {} : { at }), definitionId: definition };
    const content = JSON.stringify(goal);
    const before = held.get(id);
    held.set(id, content);
    if (before === undefined) {
      return appendedTo(stream, 'goal_created', { playbook, position, goal }, context);
    }
    return before === content ? Promise.resolve() : appendedTo(stream, 'goal_updated', { goal }, context);
  };
  return (goals, at) =>
    listedOf(goals).reduce<Promise<void>>(async (before, goal, position) => {
      await before;
      await savedOne(goal, position, at);
    }, Promise.resolve());
}

export interface Book {
  readonly ledger: Ledger['Service'];
  readonly append: (stream: string, type: string, data: Schema.Json, context?: Partial<Context>) => Promise<void>;
  readonly appendWhole: (stream: string, type: string, data: Schema.Json, context?: Partial<Context>) => Promise<void>;
  readonly goalsSaved: GoalsSaving;
  readonly workflowSaved: (name: string, version: number, contributes?: Schema.Json, at?: string) => Promise<void>;
  readonly workflowChanged: (name: string, type: string, data: Schema.Json, context: Partial<Context>) => Promise<void>;
  readonly definitionChanged: (
    definition: { readonly type: string; readonly name: string },
    fact: string,
    data: Schema.Json,
    context: Partial<Context>,
  ) => Promise<void>;
  readonly rows: (table: string, goal?: string) => Promise<Readonly<Record<string, ProjectedRow>>>;
  readonly factsOf: (goal: string, stream: string) => Promise<readonly string[]>;
}

function definitionStreamOf(type: string, name: string): string {
  return `definition/acme/${type}-of-${name}/definitions/${type}`;
}

function workflowStreamOf(name: string): string {
  return definitionStreamOf('workflow', name);
}

function workflowSaveOf(
  name: string,
  version: number,
  contributes: Schema.Json | undefined,
  savedAt: string | undefined,
): readonly [string, Schema.Json, Partial<Context>] {
  return [
    version === 1 ? 'definition_created' : 'definition_updated',
    {
      content: { source: `document: ${name}`, ...(contributes === undefined ? {} : { details: { contributes } }) },
      ...(version === 1 ? { created_by: { id: 'person:owner', name: 'Owner' }, playbook: sales.playbook } : {}),
    },
    {
      ...(savedAt === undefined ? {} : { at: savedAt }),
      definitionType: 'workflow',
      definitionName: name,
      definitionVersion: version,
    },
  ];
}

export function goalsMemoryLedger() {
  return memoryLedgerWith({
    projections: goalsLedger.projections,
    definitionNames: definitionAndGoalNamesOf(definitionTypeOrder),
  });
}

export function bookOf(): Book {
  const { service } = goalsMemoryLedger();
  const at = new Date(monday - 3_600_000).toISOString();
  const appendedTo = (stream: string, type: string, data: Schema.Json, context: Partial<Context> = {}) =>
    Effect.runPromise(
      Effect.asVoid(
        service.execute(stream, verbatim, {
          type,
          data,
          context: { at, by: 'person:owner', ...context },
        }),
      ),
    );
  const append: Book['append'] = (stream, type, data, context) =>
    appendedTo(`${salesKey}${stream}`, type, data, context);
  return {
    ledger: service,
    append,
    appendWhole: appendedTo,
    goalsSaved: goalsSavedBy(appendedTo, sales),
    workflowChanged: (name, type, data, context) => appendedTo(workflowStreamOf(name), type, data, context),
    definitionChanged: ({ type, name }, fact, data, context) =>
      appendedTo(definitionStreamOf(type, name), fact, data, context),
    workflowSaved: (name, version, contributes, savedAt) =>
      appendedTo(workflowStreamOf(name), ...workflowSaveOf(name, version, contributes, savedAt)),
    rows: async (table, goal) => {
      const under = goal === undefined ? sales : { org: sales.org, definition: goalIdentityOf(goal) };
      const kept = await Effect.runPromise(service.readProjectedRows(table, under, allOf));
      return Object.fromEntries(kept.map(({ key, row }) => [key, row]));
    },
    factsOf: async (goal, stream) => {
      const { state } = await Effect.runPromise(
        service.load(`definition/${sales.org}/${goalIdentityOf(goal)}/${stream}`, typesFold),
      );
      return state;
    },
  };
}

interface Finished {
  readonly id: string;
  readonly run?: string;
  readonly workflow?: string;
  readonly version?: number;
  readonly at?: number;
  readonly data?: unknown;
  readonly context?: Partial<Context>;
  readonly type?: string;
}

export const onSchedule: Partial<Context> = { trigger: { kind: 'cron', reference: '/schedule/cron' } };

export function finished({
  id,
  run = `run-${id}`,
  workflow = 'measure',
  version = 1,
  at = monday,
  data = { output: {} },
  context = onSchedule,
  type = 'run_succeeded',
}: Finished): FollowedRecord {
  const record: RecordedEvent = {
    id,
    causationId: null,
    correlationId: run,
    stream: `runs/${run}`,
    version: 3,
    globalPosition: 3,
    type,
    data,
    context: {
      at: new Date(at).toISOString(),
      by: 'playbook:sales',
      runId: run,
      definitionType: 'workflow',
      definitionName: workflow,
      definitionVersion: version,
      ...context,
    },
    recordedAt: new Date(at).toISOString(),
    cursor: id,
  };
  return {
    playbook: sales,
    playbookKey: salesKey,
    filedUnder: salesKey,
    record,
    event: {
      event: { specversion: '1.0', id, source: 'auto', type, time: new Date(at).toISOString() },
      depth: 0,
      emitter: undefined,
      ownedBy: [],
      topRun: undefined,
    },
  };
}

interface Delivered {
  readonly keys: readonly string[];
  readonly failed: readonly string[];
  readonly batches: number;
}

export function delivering(assessor: Consumer, followed: FollowedRecord, most = 100): Effect.Effect<Delivered> {
  return Effect.gen(function* () {
    const keys: string[] = [];
    const failed: string[] = [];
    let after: string | undefined;
    let batches = 0;
    for (;;) {
      batches += 1;
      const batch = yield* assessor.batchOf(followed, after, most);
      for (const delivery of batch.deliveries) {
        const done = yield* Effect.result(delivery.deliver);
        (Result.isSuccess(done) ? keys : failed).push(delivery.key);
        yield* delivery.skipped({ detail: 'skipped' });
      }
      if (!batch.more) {
        return { keys, failed, batches };
      }
      after = batch.through;
    }
  });
}

export function deliveredAll(assessor: Consumer, followed: FollowedRecord, most = 100): Promise<Delivered> {
  return Effect.runPromise(delivering(assessor, followed, most));
}
