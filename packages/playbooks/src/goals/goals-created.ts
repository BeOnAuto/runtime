import { Caller, OrgContext, withNotices, withStudioLink, type StudioPage } from '@on.auto/operations';
import { Effect } from 'effect';

import { playbookRegistered, type Creating } from '../operations/create-playbook.ts';
import { foundPlaybook } from '../operations/registry-loading.ts';
import { beforeBuildingAfterCreateOf, goalsWanted } from '../plain-language/goals-words.ts';
import { takenBy } from '../registry/registry-decisions.ts';
import { heldOn } from './held-goals.ts';
import type { CheckedGoals, PlaybookGoals } from './playbook-goals.ts';

export interface CreatingWithGoals extends Creating {
  readonly goals?: string;
}

export function leadPageOf(playbook: string, { goals }: Pick<CheckedGoals, 'goals'>): StudioPage {
  const [lead] = goals;
  return lead === undefined ? { kind: 'playbook', playbook } : { kind: 'goal', playbook, goal: lead.id };
}

function repairedAfterTaken(playbook: string) {
  return Effect.gen(function* () {
    const existing = yield* Effect.orDie(foundPlaybook(playbook));
    const caller = yield* Caller;
    return existing.status === 'active' && existing.created_by.id === caller.id ? existing : yield* takenBy(existing);
  });
}

export function playbookCreatedWithGoals<Checked extends CheckedGoals>(
  goals: PlaybookGoals<Checked>,
  { goals: source, ...creating }: CreatingWithGoals,
) {
  return Effect.gen(function* () {
    if (source === undefined) {
      return yield* goalsWanted('/goals', goals.messages);
    }
    const checked = yield* goals.check(source, creating);
    const registered = yield* playbookRegistered(creating).pipe(
      Effect.catchTag('conflict', () => repairedAfterTaken(creating.playbook)),
    );
    const { org } = yield* OrgContext;
    const held = yield* goals.save({ org, playbook: creating.playbook }, { goals: checked, onlyIfNone: true });
    if (held.outcome === 'already_held') {
      return yield* takenBy(registered);
    }
    const created = { ...heldOn(registered, held), before_building: beforeBuildingAfterCreateOf(goals.messages) };
    return withNotices(yield* withStudioLink(created, leadPageOf(creating.playbook, checked)), held.notices ?? []);
  });
}
