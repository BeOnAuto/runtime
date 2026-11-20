import { goalsLedger } from '@on.auto/goals';
import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { ContextSchema, Ledger, streamPrefixOfDefinition, type Decider } from '@on.auto/operations';
import { Effect, ManagedRuntime, Result, Schema } from 'effect';
import { afterAll, afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { goalIdentityIn } from '../testing/goals/goal-identities.ts';
import { onTheLedgerIn, tableDropped } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { createdWithGoals, leadGoalId, servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';

const FactSchema = Schema.Struct({ type: Schema.String, data: Schema.Json, context: ContextSchema });

type Fact = typeof FactSchema.Type;

const verbatim: Decider<null, Fact, Fact> = {
  initialState: null,
  evolve: () => null,
  decide: ({ type, data }) => Result.succeed([{ type, data }]),
  context: ({ context }) => context,
  eventSchema: FactSchema,
};

const passed = '6f1c7a2e-3b4d-5e6f-8a9b-0c1d2e3f4a5b';

const late = '7a2d8b3f-4c5e-5f60-9b0a-1d2e3f4a5b6c';

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const judgedAt = hoursAgo(2);

const overdueSince = hoursAgo(1);

const fact = (type: string, data: Schema.JsonObject, at: string): Fact => ({
  type,
  data,
  context: { at, by: 'playbook:alpha' },
});

const opened = (at: string) =>
  fact(
    'goal_assessment_opened',
    { goal_version: 1, rule: { settles: 'on_crossing', target: { at_least: 1 } }, milestones: [] },
    at,
  );

const history: readonly (readonly [string, Fact])[] = [
  [passed, opened(hoursAgo(3))],
  [passed, fact('goal_assessed', { verdict: 'passed', at: judgedAt, by: 'crossing', told: 'now' }, judgedAt)],
  [late, opened(hoursAgo(3))],
  [late, fact('goal_overdue', { since: overdueSince, told: 'now' }, overdueSince)],
];

const laterResult = '1a2b3c4d-5e6f-5a7b-8c9d-0e1f2a3b4c5d';

const earlierResult = '2b3c4d5e-6f7a-5b8c-9d0e-1f2a3b4c5d6e';

const caughtUp = hoursAgo(0.5);

const laterNames = hoursAgo(5);

const earlierNames = hoursAgo(7);

const together: typeof history = [
  [laterResult, opened(hoursAgo(8))],
  [laterResult, fact('goal_assessed', { verdict: 'failed', at: laterNames, by: 'final', told: 'now' }, caughtUp)],
  [earlierResult, opened(hoursAgo(8))],
  [earlierResult, fact('goal_assessed', { verdict: 'failed', at: earlierNames, by: 'final', told: 'now' }, caughtUp)],
];

async function recordedIn(fileName: string, facts: typeof history = history): Promise<void> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName, projections: goalsLedger.projections }));
  await runtime.runPromise(
    Effect.flatMap(Effect.service(Ledger), (ledger) =>
      Effect.flatMap(goalIdentityIn(ledger, leadGoalId), (definition) =>
        Effect.forEach(
          facts,
          ([id, { type, data, context }]) =>
            ledger.execute(`${streamPrefixOfDefinition({ org: 'acme', definition })}assessments/${id}`, verbatim, {
              type,
              data,
              context: { ...context, definitionId: definition },
            }),
          { discard: true },
        ),
      ),
    ),
  );
  await runtime.dispose();
}

const ledger = temporaryLedger();

let server: ReasoningServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

afterAll(() => {
  ledger.remove();
});

async function served(serving: typeof servingReasoning): Promise<ReasoningServer> {
  server = await serving([], {}, undefined, { ledger });
  return server;
}

const activity = '/v1/orgs/acme/activity';

describe('the bell of a Node server that keeps goals', () => {
  it('lists a verdict and an overdue of a goal with its word, counts them, and marks the verdict seen by its address', async () => {
    const made = await served(servingReasoningWithGoals);
    expect(await createdWithGoals(made)).toMatchObject({ status: 201 });
    await made.stop();
    server = undefined;
    await recordedIn(ledger.fileName);
    const on = await served(servingReasoningWithGoals);

    const listed = await on.call('GET', `${activity}?kind=goal,goal_overdue`);
    const marked = await on.call('POST', `${activity}/seen`, {
      body: { items: [{ address: `alpha/assessments/${passed}`, at: judgedAt }] },
    });

    expect(listed).toMatchObject({
      status: 200,
      body: {
        rows: [
          { kind: 'goal_overdue', address: `alpha/assessments/${late}`, outcome: 'overdue', word: null, seen: null },
          {
            kind: 'goal',
            address: `alpha/assessments/${passed}`,
            at: judgedAt,
            goal: leadGoalId,
            outcome: 'passed',
            word: 'Brought a customer',
            seen: false,
          },
        ],
        counts: { goals: 2 },
      },
    });
    expect(marked).toMatchObject({ status: 200, body: { counts: { goals: 1 } } });
  });

  it('is as it is today on a server that keeps none, whose bell refuses the kinds of goals', async () => {
    const off = await served(servingReasoning);

    const refused = await off.call('GET', `${activity}?kind=goal`);
    const listed = await off.call('GET', activity);
    const marked = await off.call('POST', `${activity}/seen`, {
      body: { items: [{ address: `alpha/assessments/${passed}`, at: judgedAt }] },
    });

    expect(refused).toMatchObject({ status: 422 });
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toMatch(/goal|outcome/u);
    expect(marked).toMatchObject({ status: 422 });
  });
});

describe('the verdicts a Node server that keeps goals recorded in the same instant', () => {
  it('lists the verdicts recorded in the same instant the latest result first, each with the time it names, on every read and after its table is filled again from the facts', async () => {
    const own = temporaryLedger();
    onTestFinished(own.remove);
    const ownServed = async () => {
      server = await servingReasoningWithGoals([], {}, undefined, { ledger: own });
      return server;
    };
    expect(await createdWithGoals(await ownServed())).toMatchObject({ status: 201 });
    await server?.stop();
    await recordedIn(own.fileName, together);
    const on = await ownServed();
    const listed = await on.call('GET', `${activity}?kind=goal`);
    const again = await on.call('GET', `${activity}?kind=goal`);
    await on.stop();
    await onTheLedgerIn(own.fileName, (connection) => connection.write(tableDropped('activity_goals_4')));
    const rebuilt = await (await ownServed()).call('GET', `${activity}?kind=goal`);

    expect(listed).toMatchObject({
      status: 200,
      body: {
        rows: [
          { address: `alpha/assessments/${laterResult}`, at: caughtUp, result_at: laterNames },
          { address: `alpha/assessments/${earlierResult}`, at: caughtUp, result_at: earlierNames },
        ],
        counts: { goals: 2 },
      },
    });
    expect(again.body).toEqual(listed.body);
    expect(rebuilt.body).toEqual(listed.body);
  });
});
