import { InvalidInput, OrgContext, withNotices } from '@on.auto/operations';
import { Effect } from 'effect';

import { foundPlaybook } from '../operations/registry-loading.ts';
import { renamedOrRedescribed, retiredAlready, type Changed } from '../operations/update-playbook.ts';
import { beforeBuildingAfterUpdateOf, type GoalRenameAsked, type GoalsSent } from '../plain-language/goals-words.ts';
import { heldOn } from './held-goals.ts';
import type {
  CheckedGoals,
  DefinitionSavedAgain,
  GoalsSaving,
  PlaybookGoals,
  PlaybookHeldSaved,
} from './playbook-goals.ts';

const nothingGivenWords = 'Give name, description, page or goals, at least one, to update the playbook';

const nothingGiven = new InvalidInput({
  detail: nothingGivenWords,
  issues: [{ pointer: '', detail: nothingGivenWords }],
});

const renameNotAloneWords = 'Give `rename_goal` alone, with no other change in the call';

const renameNotAlone = new InvalidInput({
  detail: renameNotAloneWords,
  issues: [{ pointer: '/rename_goal', detail: renameNotAloneWords }],
});

export interface UpdatingWithGoals extends Changed {
  readonly playbook: string;
  readonly goals?: string;
  readonly rename_goal?: GoalRenameAsked;
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

function answeredAfterSaving<Answered extends object>(
  answered: Answered,
  saved: PlaybookHeldSaved | undefined,
  sent: boolean,
  messages: boolean,
) {
  return withNotices(
    withBeforeBuilding(answered, { sent, awaiting: saved?.awaiting === true }, messages),
    saved?.notices ?? [],
  );
}

function withUpdatedDefinitions<Answered extends object>(
  answered: Answered,
  savedAgain: readonly DefinitionSavedAgain[],
) {
  return savedAgain.length === 0 ? answered : { ...answered, updated_definitions: savedAgain };
}

function goalRenamedIn<Checked extends CheckedGoals>(
  goals: PlaybookGoals<Checked>,
  playbook: string,
  { id, new_id: to }: GoalRenameAsked,
) {
  return Effect.gen(function* () {
    const existing = yield* foundPlaybook(playbook);
    if (existing.status === 'retired') {
      return yield* retiredAlready(playbook);
    }
    const address = { org: (yield* OrgContext).org, playbook };
    const { savedAgain, ...held } = yield* goals.rename(address, { from: id, to });
    return withUpdatedDefinitions(heldOn(existing, held), savedAgain);
  });
}

function playbookChanged<Checked extends CheckedGoals>(
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
    return answeredAfterSaving(answered, saved, source !== undefined, goals.messages);
  });
}

export function playbookUpdatedWithGoals<Checked extends CheckedGoals>(
  goals: PlaybookGoals<Checked>,
  updating: UpdatingWithGoals,
) {
  const { rename_goal: renaming, playbook, ...changed } = updating;
  if (renaming === undefined) {
    return playbookChanged(goals, updating);
  }
  const alone = Object.values(changed).every((given) => given === undefined);
  return alone ? goalRenamedIn(goals, playbook, renaming) : Effect.fail(renameNotAlone);
}
