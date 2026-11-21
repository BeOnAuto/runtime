import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { contentHoldersOf, Ledger, playbookLedgerOf, PlaybookWriter } from '@on.auto/operations';
import { Effect, ManagedRuntime, Option, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { definitionAndGoalNamesOf } from '../identity/names-of-a-playbook.ts';
import { definitionDecider, definitionFoldOf, definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { goalsDocumentOfTheExamples } from '../testing/goals-book.ts';
import { decisionsOnGoalsAndDefinitions, GoalOrDefinitionEventSchema } from './decisions-on-goals-and-definitions.ts';
import { goalDecider, goalFoldOf, goalStream } from './goal-decider.ts';
import { experiments } from './goal-examples.ts';

const at = { by: 'acme-admin', at: '2026-11-20T09:00:00.000Z' };

const savedIn = { org: 'acme', playbook: 'alpha' };

const goal = Option.getOrThrow(Option.fromNullishOr(goalsDocumentOfTheExamples([experiments]).goals[0]));

const goalId = '019a8f00-0000-7000-8000-000000000001';

const workflowId = '019a8f00-0000-7000-8000-000000000002';

const source = 'steps: []\n';

const decisions = decisionsOnGoalsAndDefinitions(
  [
    {
      definition: goalId,
      stream: goalStream,
      decider: goalDecider(goalId),
      command: { type: 'save', goal, position: 0, playbook: savedIn.playbook, ...at },
    },
  ],
  [
    {
      definition: workflowId,
      stream: definitionTypeStreamOf('workflow'),
      decider: definitionDecider('workflow', savedIn, workflowId),
      command: {
        type: 'create',
        name: 'lead-intake',
        content: { source },
        created_by: { id: at.by, name: at.by },
        definition_id: workflowId,
        ...at,
      },
    },
  ],
);

const [onTheGoal, onADefinition] = decisions;

function aLedgerOnSQLite(): Promise<Ledger['Service']> {
  const runtime = ManagedRuntime.make(
    ledgerLayer({
      fileName: ':memory:',
      holders: contentHoldersOf([GoalOrDefinitionEventSchema]),
      definitionNames: definitionAndGoalNamesOf(['workflow']),
    }),
  );
  onTestFinished(() => runtime.dispose());
  return runtime.runPromise(Effect.service(Ledger));
}

function streamOf(definition: string, stream: string): string {
  return `definition/${savedIn.org}/${definition}/${stream}`;
}

describe('decisions on goals and on definitions, together in one append', () => {
  it("give every decider of the call one schema, the goals' facts and the definitions', which keeps the definitions' payloads", () => {
    expect(decisions.map(({ decider }) => decider.eventSchema)).toEqual([
      GoalOrDefinitionEventSchema,
      GoalOrDefinitionEventSchema,
    ]);
    expect([...contentHoldersOf([GoalOrDefinitionEventSchema]).keys()]).toEqual([
      'definition_created',
      'definition_updated',
      'definition_restored',
    ]);
  });

  it("append a goal's facts first and a definition's after them on SQLite, each folded on its stream by its own decider", async () => {
    const ledger = await aLedgerOnSQLite();

    const decided = await Effect.runPromise(
      PlaybookWriter.use((writer) => writer.executeOnDefinitions(decisions)).pipe(
        Effect.provide(playbookLedgerOf(ledger, savedIn)),
      ),
    );
    const theGoal = await Effect.runPromise(ledger.load(streamOf(goalId, goalStream), goalFoldOf(goalId)));
    const theWorkflow = await Effect.runPromise(
      ledger.load(streamOf(workflowId, definitionTypeStreamOf('workflow')), definitionFoldOf(workflowId)),
    );

    expect(decided.map(({ version }) => version)).toEqual([1, 1]);
    expect([theGoal.version, theGoal.state?.name, theGoal.state?.playbook]).toEqual([1, goal.id, savedIn.playbook]);
    expect([theWorkflow.version, theWorkflow.state?.name, theWorkflow.state?.status]).toEqual([
      1,
      'lead-intake',
      'active',
    ]);
  });
});

describe('a decision on a goal beside one on a definition', () => {
  it("folds nothing of the other's facts, and takes the other's state or command as a defect", () => {
    const factOf = Schema.decodeUnknownSync(GoalOrDefinitionEventSchema);
    const goalFact = factOf({ type: 'goal_removed', data: {}, context: { ...at, definitionId: goalId } });
    const definitionFact = factOf({
      type: 'definition_retired',
      data: {},
      context: { ...at, definitionType: 'workflow', definitionName: 'lead-intake', definitionVersion: 1 },
    });
    const goalHeld = { goal: undefined };
    const definitionHeld = { definition: undefined };
    const removing = { goal: { type: 'remove' as const, playbook: savedIn.playbook, ...at } };

    expect(onTheGoal?.decider.evolve(goalHeld, definitionFact)).toBe(goalHeld);
    expect(onADefinition?.decider.evolve(definitionHeld, goalFact)).toBe(definitionHeld);
    expect(() => onTheGoal?.decider.evolve(definitionHeld, goalFact)).toThrow(TypeError);
    expect(() => onADefinition?.decider.decide(removing, definitionHeld)).toThrow(TypeError);
  });
});
