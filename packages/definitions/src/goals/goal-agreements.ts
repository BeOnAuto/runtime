import {
  Conflict,
  InvalidInput,
  PlaybookReader,
  PlaybookWriter,
  type Decided,
  type Decider,
} from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { commandMetadata } from '../operations/command-metadata.ts';
import { agentIssue, type GoalIssue } from './goal-issues.ts';
import type { Goal } from './goals-document.ts';
import { GoalAgreementsEventSchema, type GoalAgreement, type RecordedGoalAgreementsEvent } from './goals-facts.ts';
import { playbookGoalsIn, type PlaybookGoals } from './goals-stream.ts';

export const goalAgreementsStream = 'goals/agreements';

export interface GoalAgreements {
  readonly agreements: readonly GoalAgreement[];
}

export interface GoalsAgreeing {
  readonly version: number;
  readonly ids?: readonly string[];
}

interface Agreeing extends GoalsAgreeing {
  readonly standing: PlaybookGoals;
  readonly by: string;
  readonly at: string;
}

const noAgreements: GoalAgreements = { agreements: [] };

const leftOutOfTheContent = new Set(['retired']);

function sortedOf(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((each: unknown) => sortedOf(each));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .toSorted((left: readonly [string, unknown], right: readonly [string, unknown]) =>
        left[0].localeCompare(right[0]),
      )
      .map(([key, each]: readonly [string, unknown]) => [key, sortedOf(each)]),
  );
}

function contentOf(goal: Goal): string {
  const kept = Object.entries(goal).filter((entry: readonly [string, unknown]) => !leftOutOfTheContent.has(entry[0]));
  return JSON.stringify(sortedOf(Object.fromEntries(kept)));
}

export function isSameContent(saved: Goal, agreed: Goal): boolean {
  return contentOf(saved) === contentOf(agreed);
}

export function agreementStanding(goal: Goal, { agreements }: GoalAgreements): GoalAgreement | undefined {
  return agreements.find((agreement) => agreement.goal === goal.id && isSameContent(goal, agreement.content));
}

function isRetired({ retired }: Goal): boolean {
  return retired === true;
}

const noGoalsYet =
  'This playbook has no saved goals yet, so there is no yes to record. Save the goals, show them to the person, then record their yes';

const everyGoalRetired = 'Every goal of this playbook is retired, so there is no yes to record';

function changedSince(seen: number, now: number): string {
  return [
    `The goals changed after version ${String(seen)}, and are at version ${String(now)} now.`,
    'Show the person the goals as they are saved now, and ask again before you record a yes',
  ].join(' ');
}

function issuesOf(named: readonly string[], { goals }: PlaybookGoals): readonly GoalIssue[] {
  return named.flatMap((id, index) => {
    const goal = goals.find((saved) => saved.id === id);
    const pointer = `/ids/${String(index)}`;
    if (goal === undefined) {
      return [agentIssue(pointer, `This playbook has no saved goal with the id ${id}`)];
    }
    return isRetired(goal)
      ? [agentIssue(pointer, `The goal ${id} is retired; a yes is recorded only for goals that are not retired`)]
      : [];
  });
}

function namedIn({ ids }: GoalsAgreeing, standing: PlaybookGoals): readonly string[] {
  return ids ?? standing.goals.filter((goal) => !isRetired(goal)).map(({ id }) => id);
}

function refusalOf(agreeing: Agreeing, named: readonly string[]): InvalidInput | Conflict | undefined {
  const { standing, version } = agreeing;
  if (standing.version === 0) {
    return new InvalidInput({ detail: noGoalsYet, issues: [] });
  }
  if (version !== standing.version) {
    return new Conflict({ detail: changedSince(version, standing.version) });
  }
  if (named.length === 0) {
    return new InvalidInput({ detail: everyGoalRetired, issues: [] });
  }
  const issues = issuesOf(named, standing);
  return issues.length === 0
    ? undefined
    : new InvalidInput({
        detail: "A yes can't be recorded for these goals",
        issues: issues.map(({ pointer, detail }) => ({ pointer, detail })),
      });
}

function agreementsAfter(agreeing: Agreeing, named: ReadonlySet<string>, state: GoalAgreements) {
  const { standing, by, at } = agreeing;
  return standing.goals.flatMap((goal): readonly { readonly agreement: GoalAgreement; readonly fresh: boolean }[] => {
    const kept = agreementStanding(goal, state);
    if (kept !== undefined) {
      return [{ agreement: kept, fresh: false }];
    }
    return named.has(goal.id)
      ? [{ agreement: { goal: goal.id, version: standing.version, at, by, content: goal }, fresh: true }]
      : [];
  });
}

function decided(
  agreeing: Agreeing,
  state: GoalAgreements,
): Result.Result<readonly Decided<RecordedGoalAgreementsEvent>[], InvalidInput | Conflict> {
  const named = namedIn(agreeing, agreeing.standing);
  const refusal = refusalOf(agreeing, named);
  if (refusal !== undefined) {
    return Result.fail(refusal);
  }
  const after = agreementsAfter(agreeing, new Set(named), state);
  if (!after.some(({ fresh }) => fresh)) {
    return Result.succeed([]);
  }
  return Result.succeed([
    { type: 'playbook_goals_agreed', data: { agreements: after.map(({ agreement }) => agreement) } },
  ]);
}

const agreementsDecider: Decider<GoalAgreements, Agreeing, RecordedGoalAgreementsEvent, 'invalid_input' | 'conflict'> =
  {
    initialState: noAgreements,
    evolve: (_standing, { data }) => ({ agreements: data.agreements }),
    decide: decided,
    context: ({ by, at }) => ({ by, at }),
    eventSchema: GoalAgreementsEventSchema,
    lastFactAlone: true,
  };

export const goalAgreementsIn: Effect.Effect<GoalAgreements, never, PlaybookReader> = PlaybookReader.use((reader) =>
  reader.load(goalAgreementsStream, agreementsDecider),
).pipe(Effect.map(({ state }) => state));

export interface GoalsAgreed {
  readonly goals: PlaybookGoals;
  readonly agreements: GoalAgreements;
}

export const playbookGoalsAgreed = Effect.fnUntraced(function* (agreeing: GoalsAgreeing) {
  const standing = yield* playbookGoalsIn;
  const metadata = yield* commandMetadata;
  const { state } = yield* (yield* PlaybookWriter).execute(goalAgreementsStream, agreementsDecider, {
    ...agreeing,
    standing,
    ...metadata,
  });
  const agreed: GoalsAgreed = { goals: standing, agreements: state };
  return agreed;
});
