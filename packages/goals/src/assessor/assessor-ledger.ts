import {
  ContextSchema,
  type Context,
  type Decider,
  type Fold,
  type Ledger,
  type ProjectedRow,
  type ProjectedRowsQuery,
  type RecordedEvent,
} from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
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

export interface Book {
  readonly ledger: Ledger['Service'];
  readonly append: (stream: string, type: string, data: Schema.Json, context?: Partial<Context>) => Promise<void>;
  readonly goalsSaved: (goals: Schema.Json, version?: number) => Promise<void>;
  readonly workflowSaved: (name: string, version: number, contributes?: Schema.Json) => Promise<void>;
  readonly rows: (table: string) => Promise<Readonly<Record<string, ProjectedRow>>>;
  readonly factsOf: (stream: string) => Promise<readonly string[]>;
}

export function bookOf(): Book {
  const { service } = memoryLedger(undefined, goalsLedger.projections);
  const at = new Date(monday - 3_600_000).toISOString();
  const append: Book['append'] = (stream, type, data, context = {}) =>
    Effect.runPromise(
      Effect.asVoid(
        service.execute(`${salesKey}${stream}`, verbatim, {
          type,
          data,
          context: { at, by: 'person:owner', ...context },
        }),
      ),
    );
  return {
    ledger: service,
    append,
    goalsSaved: (goals, version = 1) =>
      append('goals/playbook', 'playbook_goals_saved', { source: 'goals', goals, version }),
    workflowSaved: (name, version, contributes) =>
      append(
        'definitions/workflow',
        version === 1 ? 'definition_created' : 'definition_updated',
        {
          content: {
            source: `document: ${name}`,
            ...(contributes === undefined ? {} : { details: { contributes } }),
          },
          ...(version === 1 ? { created_by: { id: 'person:owner', name: 'Owner' } } : {}),
        },
        { definitionType: 'workflow', definitionName: name, definitionVersion: version },
      ),
    rows: async (table) => {
      const kept = await Effect.runPromise(service.readProjectedRows(table, sales, allOf));
      return Object.fromEntries(kept.map(({ key, row }) => [key, row]));
    },
    factsOf: async (stream) => {
      const { state } = await Effect.runPromise(service.load(`${salesKey}${stream}`, typesFold));
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
