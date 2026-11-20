import {
  ContextSchema,
  playbookLedgerOf,
  type Context,
  type Decider,
  type PlaybookReader,
  type ProjectedRow,
  type RecordedEvent,
  PlaybookContext,
} from '@on.auto/operations';
import { playbooksStreamOfOrg } from '@on.auto/playbooks';
import {
  StartRefused,
  StartRejected,
  type DueWork,
  type FunctionStart,
  type StartFunction,
} from '@on.auto/workflow-host';
import { Effect, Result, Schema } from 'effect';

import { assessmentIdOf, noticeRunIdOf, type NoticeChange } from '../assessments/assessment-identity.ts';
import { goalIdentityOf, goalsMemoryLedger, goalsSavedBy, type GoalsSaving } from '../assessor/assessor-ledger.ts';
import { NoticeRefusalsSchema, type NoticeRefusals } from '../goal-tables/assessment-row-state.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import type { NoticeLedger } from './notice-ledger.ts';

export const sales = { org: 'acme', playbook: 'sales' };

const salesKey = 'playbook/acme/sales/';

export const monday = Date.parse('2026-11-09T09:00:00.000Z');

export const owner = { id: 'person:ada', name: 'Ada' };

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
  milestones: [{ id: 'live', label: 'Taken live', by: 'person' }],
  notify: { passed: 'now', failed: 'quiet', overdue: 'summary', through: 'tell-owner' },
};

export const experimentsGoal = goalIdentityOf(experiments.id);

export const assessment = assessmentIdOf({ definition: experimentsGoal, per: 'experiment-7' });

export function runOf(change: NoticeChange): string {
  return noticeRunIdOf(assessment, change);
}

const FactSchema = Schema.Struct({ type: Schema.String, data: Schema.Json, context: ContextSchema });

type Fact = typeof FactSchema.Type;

const verbatim: Decider<null, Fact, Fact> = {
  initialState: null,
  evolve: () => null,
  decide: ({ type, data }) => Result.succeed([{ type, data }]),
  context: ({ context }) => context,
  eventSchema: FactSchema,
};

const opened = {
  goal_version: 1,
  per: { id: 'experiment-7' },
  rule: { settles: 'on_crossing', target: { at_least: 1 } },
  milestones: experiments.milestones,
};

export interface StartsSeen {
  readonly starts: readonly FunctionStart[];
  readonly start: StartFunction;
}

export type Answer = 'started' | 'unavailable' | 'rejected';

export function startsAnswering(answers: () => Answer): StartsSeen {
  const starts: FunctionStart[] = [];
  return {
    starts,
    start: (asked) =>
      Effect.suspend((): Effect.Effect<void, StartRefused | StartRejected> => {
        starts.push(asked);
        const answer = answers();
        if (answer === 'unavailable') {
          return Effect.fail(new StartRefused({ detail: 'The runtime is busy' }));
        }
        return answer === 'rejected'
          ? Effect.fail(new StartRejected({ detail: 'The function tell-owner is paused', kind: 'paused' }))
          : Effect.void;
      }),
  };
}

export interface NoticeBook {
  readonly ledger: NoticeLedger;
  readonly append: (stream: string, type: string, data: Schema.Json, context?: Partial<Context>) => Promise<void>;
  readonly appendAt: (stream: string, type: string, data: Schema.Json, context?: Partial<Context>) => Promise<void>;
  readonly ofTheGoal: (stream: string, type: string, data: Schema.Json, context?: Partial<Context>) => Promise<void>;
  readonly goalsSaved: GoalsSaving;
  readonly playbookCreated: () => Promise<void>;
  readonly playbookRetired: () => Promise<void>;
  readonly playbookFact: (type: string, data: Schema.Json) => Promise<void>;
  readonly opened: () => Promise<void>;
  readonly assessed: (verdict: 'passed' | 'failed', told: string, at?: number) => Promise<void>;
  readonly runStarted: (run: string, reference?: string) => Promise<RecordedEvent>;
  readonly column: (name: string) => Promise<unknown>;
  readonly refusals: () => Promise<NoticeRefusals>;
  readonly factsOf: (stream: string) => Promise<readonly string[]>;
  readonly inThePlaybook: <A>(work: Effect.Effect<A, never, PlaybookReader | PlaybookContext>) => Promise<A>;
}

const typesFold = {
  initialState: [],
  evolve: (types: readonly string[], { type }: Fact) => [...types, type],
  eventSchema: FactSchema,
};

const refusalsOfText = Schema.decodeUnknownSync(NoticeRefusalsSchema);

function firstRecordOf(service: NoticeLedger, run: string): Promise<RecordedEvent> {
  return Effect.runPromise(
    Effect.orDie(
      Effect.flatMap(service.readRecorded(sales, { kind: 'run', run }, { order: 'asc', limit: 1 }), ({ records }) =>
        Effect.fromNullishOr(records[0]),
      ),
    ),
  );
}

async function rowsOf(service: NoticeLedger): Promise<readonly ProjectedRow[]> {
  const rows = await Effect.runPromise(
    service.readProjectedRows(assessmentsName, sales, { where: [], orderBy: [], order: 'asc', limit: 10 }),
  );
  return rows.filter(({ key }) => key === assessment).map(({ row }) => row);
}

export function noticeBookOf(): NoticeBook {
  const { service } = goalsMemoryLedger();
  const at = new Date(monday - 3_600_000).toISOString();
  const appendTo = (stream: string, type: string, data: Schema.Json, context: Partial<Context> = {}) =>
    Effect.runPromise(
      Effect.asVoid(service.execute(stream, verbatim, { type, data, context: { at, by: 'person:ada', ...context } })),
    );
  const append: NoticeBook['append'] = (stream, type, data, context) =>
    appendTo(`${salesKey}${stream}`, type, data, context);
  const streamOfIt = `definition/acme/${experimentsGoal}/assessments/${assessment}`;
  const ofTheGoal = { definitionId: experimentsGoal };
  return {
    ledger: service,
    append,
    appendAt: appendTo,
    ofTheGoal: (stream, type, data, context) =>
      appendTo(`definition/acme/${experimentsGoal}/${stream}`, type, data, { ...context, ...ofTheGoal }),
    goalsSaved: goalsSavedBy(appendTo, sales),
    playbookCreated: () =>
      appendTo(playbooksStreamOfOrg('acme'), 'playbook_created', {
        playbook: 'sales',
        name: 'Sales',
        description: 'Sales',
        created_by: owner,
      }),
    playbookRetired: () => appendTo(playbooksStreamOfOrg('acme'), 'playbook_retired', { playbook: 'sales' }),
    playbookFact: (type, data) => appendTo(playbooksStreamOfOrg('acme'), type, data),
    opened: () => appendTo(streamOfIt, 'goal_assessment_opened', opened, { by: 'playbook:sales', ...ofTheGoal }),
    assessed: (verdict, told, when = monday) =>
      appendTo(
        streamOfIt,
        'goal_assessed',
        { verdict, at: new Date(when).toISOString(), by: 'crossing', told },
        { by: 'playbook:sales', ...ofTheGoal },
      ),
    runStarted: async (run, reference = `goals/${experimentsGoal}/assessments/${assessment}`) => {
      await append(`runs/${run}`, 'run_started', { input: {} }, { trigger: { kind: 'goal', reference } });
      return firstRecordOf(service, run);
    },
    column: async (name) => (await rowsOf(service)).map((row) => row[name])[0],
    refusals: async () => refusalsOfText((await rowsOf(service)).map((row) => row['notice_refusals'])[0]),
    factsOf: async (stream) =>
      (await Effect.runPromise(service.load(`definition/acme/${experimentsGoal}/${stream}`, typesFold))).state,
    inThePlaybook: (work) =>
      Effect.runPromise(
        Effect.provideContext(Effect.provideService(work, PlaybookContext, sales), playbookLedgerOf(service, sales)),
      ),
  };
}

export async function performedAt(work: DueWork, now: number): Promise<number> {
  const items = await Effect.runPromise(work.due(now, 10, false));
  await Effect.runPromise(Effect.forEach(items, ({ perform }) => perform(now)));
  return items.length;
}
