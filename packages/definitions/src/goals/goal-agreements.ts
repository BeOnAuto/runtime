import { InvalidInput, PlaybookContext, PlaybookWriter } from '@on.auto/operations';
import { Effect } from 'effect';

import { commandMetadata } from '../operations/command-metadata.ts';
import { goalDecider, goalStream, isRetired, retiredWords, type GoalState } from './goal-decider.ts';
import { agentIssue, type GoalIssue } from './goal-issues.ts';
import { goalStatesIn, playbookGoalsIn } from './playbook-goals.ts';

export interface GoalSeen {
  readonly id: string;
  readonly version: number;
}

export interface GoalsAgreeing {
  readonly goals: readonly GoalSeen[];
}

const noGoalsYet =
  'This playbook has no saved goals yet, so there is no yes to record. Save the goals, show them to the person, then record their yes';

function issueOf({ id }: GoalSeen, index: number, held: GoalState | undefined): readonly GoalIssue[] {
  const pointer = `/goals/${String(index)}/id`;
  if (held === undefined) {
    return [agentIssue(pointer, `This playbook has no saved goal with the id ${id}`)];
  }
  return isRetired(held) ? [agentIssue(pointer, retiredWords(id))] : [];
}

function refusalOf(named: readonly GoalSeen[], states: readonly GoalState[]): InvalidInput | undefined {
  if (states.length === 0) {
    return new InvalidInput({ detail: noGoalsYet, issues: [] });
  }
  const byName = new Map(states.map((state) => [state.name, state]));
  const issues = named.flatMap((seen, index) => issueOf(seen, index, byName.get(seen.id)));
  return issues.length === 0
    ? undefined
    : new InvalidInput({
        detail: "A yes can't be recorded for these goals",
        issues: issues.map(({ pointer, detail }) => ({ pointer, detail })),
      });
}

export const playbookGoalsAgreed = Effect.fnUntraced(function* ({ goals: named }: GoalsAgreeing) {
  const states = yield* goalStatesIn;
  const refusal = refusalOf(named, states);
  if (refusal !== undefined) {
    return yield* refusal;
  }
  const { playbook } = yield* PlaybookContext;
  const metadata = yield* commandMetadata;
  const seen = Map.groupBy(named, ({ id }) => id);
  yield* (yield* PlaybookWriter).executeOnDefinitions(
    states.flatMap(({ definition, name }) => {
      const versions = seen.get(name)?.map(({ version }) => version);
      return versions === undefined
        ? []
        : [
            {
              definition,
              stream: goalStream,
              decider: goalDecider(definition),
              command: { type: 'agree' as const, playbook, seen: versions, ...metadata },
            },
          ];
    }),
  );
  return yield* playbookGoalsIn;
});
