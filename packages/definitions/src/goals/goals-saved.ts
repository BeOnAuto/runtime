import { InvalidInput, PlaybookContext, PlaybookWriter, randomUUIDv7, type Issue } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { commandMetadata } from '../operations/command-metadata.ts';
import { decidedOnAGoal, goalDecider, goalStream, type GoalCommand, type GoalState } from './goal-decider.ts';
import { agentIssue, notReplacing, type GoalIssue } from './goal-issues.ts';
import type { GoalsDocument } from './goals-document.ts';
import { goalStatesIn } from './playbook-goals.ts';

export interface GoalsSave {
  readonly document: GoalsDocument;
  readonly assessed: ReadonlySet<string>;
  readonly onlyIfNone?: boolean;
}

type GoalsSaveOutcome = 'saved' | 'unchanged' | 'already_held';

interface SavedGoals {
  readonly outcome: GoalsSaveOutcome;
}

interface GoalDecision {
  readonly definition: string;
  readonly held: GoalState | undefined;
  readonly command: GoalCommand;
}

function leftOutIssueOf(id: string): GoalIssue {
  return agentIssue(
    '',
    `The goal ${id} has been judged and cannot be left out; keep it in the list with retired set to true`,
  );
}

function issuesOf(decisions: readonly GoalDecision[]): readonly Issue[] {
  return decisions.flatMap(({ held, command }) => {
    const decided = decidedOnAGoal(command, held);
    return Result.isFailure(decided) && decided.failure instanceof InvalidInput ? decided.failure.issues : [];
  });
}

function recordsSomething({ held, command }: GoalDecision): boolean {
  const decided = decidedOnAGoal(command, held);
  return Result.isSuccess(decided) && decided.success.length > 0;
}

const savingOf = Effect.fnUntraced(function* (held: readonly GoalState[], document: GoalsDocument) {
  const { playbook } = yield* PlaybookContext;
  const acting = { playbook, ...(yield* commandMetadata) };
  const byName = new Map(held.map((state) => [state.name, state]));
  const saving = yield* Effect.forEach(document.goals, (goal, position) =>
    Effect.gen(function* () {
      const kept = byName.get(goal.id);
      const decision: GoalDecision = {
        definition: kept === undefined ? yield* Effect.sync(randomUUIDv7) : kept.definition,
        held: kept,
        command: { type: 'save', goal, position, ...acting },
      };
      return decision;
    }),
  );
  const named = new Set(document.goals.map(({ id }) => id));
  const removing = held
    .filter(({ name }) => !named.has(name))
    .map((state): GoalDecision => ({
      definition: state.definition,
      held: state,
      command: { type: 'remove', ...acting },
    }));
  return [...saving, ...removing];
});

function refusalOf(decisions: readonly GoalDecision[], leftOut: readonly string[]): InvalidInput | undefined {
  const issues = [...leftOut.map((id) => leftOutIssueOf(id)), ...issuesOf(decisions)];
  return issues.length === 0 ? undefined : notReplacing(issues);
}

export const playbookGoalsSaved = Effect.fnUntraced(function* ({ document, assessed, onlyIfNone = false }: GoalsSave) {
  const held = yield* goalStatesIn;
  if (onlyIfNone && held.length > 0) {
    const kept: SavedGoals = { outcome: 'already_held' };
    return kept;
  }
  const decisions = yield* savingOf(held, document);
  const named = new Set(document.goals.map(({ id }) => id));
  const judged = held.filter(({ name }) => !named.has(name) && assessed.has(name)).map(({ name }) => name);
  const refusal = refusalOf(decisions, judged);
  if (refusal !== undefined) {
    return yield* refusal;
  }
  const changing = decisions.filter((decision) => recordsSomething(decision));
  if (changing.length === 0) {
    const unchanged: SavedGoals = { outcome: 'unchanged' };
    return unchanged;
  }
  yield* (yield* PlaybookWriter).executeOnDefinitions(
    changing.map(({ definition, command }) => ({
      definition,
      stream: goalStream,
      decider: goalDecider(definition),
      command,
    })),
  );
  const saved: SavedGoals = { outcome: 'saved' };
  return saved;
});
