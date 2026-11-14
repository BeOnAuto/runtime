import { InvalidInput, OrgContext } from '@on.auto/operations';
import { Effect } from 'effect';

import { foundPlaybook } from '../operations/registry-loading.ts';
import { renamedOrRedescribed, retiredAlready, type Changed } from '../operations/update-playbook.ts';
import { beforeBuildingAfterUpdateOf, type GoalsSent } from '../plain-language/goals-words.ts';
import { heldOn } from './held-goals.ts';
import type { CheckedGoals, GoalsSaving, PlaybookGoals } from './playbook-goals.ts';

const nothingGivenWords = 'Give name, description, page or goals, at least one, to update the playbook';

const nothingGiven = new InvalidInput({
  detail: nothingGivenWords,
  issues: [{ pointer: '', detail: nothingGivenWords }],
});

export interface UpdatingWithGoals extends Changed {
  readonly playbook: string;
  readonly goals?: string;
}

function savingOf<Checked extends CheckedGoals>(
  page: string | null | undefined,
  goals: Checked | undefined,
): GoalsSaving<Checked> {
  return { ...(page === undefined ? {} : { page }), ...(goals === undefined ? {} : { goals }) };
}

function withBeforeBuilding<Answered extends object>(answered: Answered, sent: GoalsSent, messages: boolean) {
  const before = beforeBuildingAfterUpdateOf(sent, messages);
  return before === undefined ? answered : { ...answered, before_building: before };
}

export function playbookUpdatedWithGoals<Checked extends CheckedGoals>(
  goals: PlaybookGoals<Checked>,
  { playbook, goals: source, ...changed }: UpdatingWithGoals,
) {
  return Effect.gen(function* () {
    if ([changed.name, changed.description, changed.page, source].every((given) => given === undefined)) {
      return yield* nothingGiven;
    }
    const existing = yield* foundPlaybook(playbook);
    if (existing.status === 'retired') {
      return yield* retiredAlready(playbook);
    }
    const checked =
      source === undefined
        ? undefined
        : yield* goals.check(source, {
            name: changed.name ?? existing.name,
            description: changed.description ?? existing.description,
          });
    const address = { org: (yield* OrgContext).org, playbook };
    const saved =
      changed.page === undefined && checked === undefined
        ? undefined
        : yield* goals.save(address, savingOf(changed.page, checked));
    const updated = yield* renamedOrRedescribed(existing, changed);
    const answered = heldOn(updated, saved ?? (yield* goals.read(address)));
    return withBeforeBuilding(
      answered,
      { sent: source !== undefined, awaiting: saved?.awaiting === true },
      goals.messages,
    );
  });
}
