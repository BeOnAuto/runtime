import { isAskedOfThePerson, withinDetailBytes, type GoalIssue, type GoalsDocument } from '@on.auto/definitions/goals';
import { InvalidInput } from '@on.auto/operations';
import { askingThePerson, goalsWantedWordsOf, purposeQuestion, type GoalsNaming } from '@on.auto/playbooks';
import { Clock, Effect, Result } from 'effect';

import { goalsCheckedOf } from '../checking/goals-checked.ts';

function problemsOf(issues: readonly GoalIssue[]): string {
  return issues.length === 1 ? 'The goals have one problem' : `The goals have ${String(issues.length)} problems`;
}

function refusalWordsOf(issues: readonly GoalIssue[], messages: boolean): string {
  const [asked] = issues.flatMap((issue) => (isAskedOfThePerson(issue) ? [issue] : []));
  if (asked === undefined) {
    return `${problemsOf(issues)}, which the issues name; each is the agent's to put right.`;
  }
  return asked.ask === purposeQuestion
    ? goalsWantedWordsOf(messages)
    : `${askingThePerson(asked.ask)} ${problemsOf(issues)}, which the issues name.`;
}

export function goalsRefusalOf(issues: readonly GoalIssue[], messages: boolean): InvalidInput {
  return new InvalidInput({
    detail: withinDetailBytes(refusalWordsOf(issues, messages)),
    issues: issues.map(({ pointer, detail }) => ({ pointer: `/goals${pointer}`, detail })),
  });
}

export function savedGoalsRefusalOf({ detail, issues }: Pick<InvalidInput, 'detail' | 'issues'>): InvalidInput {
  return new InvalidInput({
    detail,
    issues: issues.map((issue) => ({ pointer: `/goals${issue.pointer}`, detail: issue.detail })),
  });
}

export function goalsCheckedWhere(
  messages: boolean,
): (source: string, naming: GoalsNaming) => Effect.Effect<GoalsDocument, InvalidInput> {
  return (source, naming) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Result.match(goalsCheckedOf(source, naming, now), {
        onSuccess: (document) => Effect.succeed(document),
        onFailure: (issues) => Effect.fail(goalsRefusalOf(issues, messages)),
      }),
    );
}
