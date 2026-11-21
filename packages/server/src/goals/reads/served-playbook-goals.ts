import type { AppRuntime } from '@on.auto/api';
import type { Capability } from '@on.auto/definitions';
import {
  goalRenamerOf,
  goalsSaveNoticesIn,
  goalStandingIn,
  playbookGoalRenamed,
  playbookGoalsSaved,
  type GoalRenamer,
  type GoalsDocument,
} from '@on.auto/definitions/goals';
import type { SubjectPages } from '@on.auto/definitions/page';
import {
  goalsAnsweredOf,
  goalsAssessedLeftOutOf,
  goalsAwaitingAYesIn,
  goalsCheckedWhere,
  savedGoalsRefusalOf,
} from '@on.auto/goals';
import { Caller, type DispatcherServices, type PlaybookAddress } from '@on.auto/operations';
import type { GoalRenaming, GoalsSaving, PlaybookGoals, PlaybookHeld } from '@on.auto/playbooks';
import { Effect, flow } from 'effect';

import { inThePlaybookOf, pageSavingOf, shownOf } from '../../composition/served-playbook-pages.ts';

function heldIn(pages: SubjectPages) {
  return Effect.gen(function* () {
    const page = shownOf(yield* pages.playbookPageOf());
    const held: PlaybookHeld = {
      ...(page === undefined ? {} : { page }),
      goals: goalsAnsweredOf(yield* goalStandingIn),
    };
    return held;
  });
}

function savedIn(pages: SubjectPages, { page, goals, onlyIfNone = false }: GoalsSaving<GoalsDocument>) {
  return Effect.gen(function* () {
    const pageSaving = page === undefined ? undefined : yield* pageSavingOf(pages, page);
    return Effect.gen(function* () {
      const saved =
        goals === undefined
          ? undefined
          : yield* playbookGoalsSaved({
              document: goals,
              assessed: yield* goalsAssessedLeftOutOf(goals),
              onlyIfNone,
            }).pipe(Effect.catchTag('invalid_input', flow(savedGoalsRefusalOf, Effect.fail)));
      if (pageSaving !== undefined) {
        yield* pages.savePlaybookPage(pageSaving);
      }
      const held = yield* heldIn(pages);
      return saved === undefined
        ? held
        : {
            ...held,
            outcome: saved.outcome,
            awaiting: yield* goalsAwaitingAYesIn,
            notices: yield* goalsSaveNoticesIn,
          };
    });
  });
}

function renamedIn(pages: SubjectPages, renamer: GoalRenamer, renaming: GoalRenaming) {
  return Effect.gen(function* () {
    const { savedAgain } = yield* playbookGoalRenamed(renamer, renaming);
    return { ...(yield* heldIn(pages)), savedAgain };
  });
}

export function playbookGoalsReadBy(runtime: AppRuntime<DispatcherServices>, pages: SubjectPages) {
  const inThePlaybook = inThePlaybookOf(runtime);
  return (address: PlaybookAddress) => inThePlaybook(address, heldIn(pages));
}

export function playbookGoalsServedBy(
  runtime: AppRuntime<DispatcherServices>,
  pages: SubjectPages,
  messages: boolean,
  capabilities: readonly Capability[],
): PlaybookGoals<GoalsDocument> {
  const inThePlaybook = inThePlaybookOf(runtime);
  const renamer = goalRenamerOf(capabilities, { pages });
  return {
    messages,
    check: goalsCheckedWhere(messages),
    read: playbookGoalsReadBy(runtime, pages),
    save: (address, saving) =>
      Effect.gen(function* () {
        const saved = yield* savedIn(pages, saving);
        const caller = yield* Caller;
        return yield* inThePlaybook(address, Effect.provideService(saved, Caller, caller));
      }),
    rename: (address, renaming) =>
      Effect.flatMap(Caller, (caller) =>
        inThePlaybook(address, Effect.provideService(renamedIn(pages, renamer, renaming), Caller, caller)),
      ),
  };
}
