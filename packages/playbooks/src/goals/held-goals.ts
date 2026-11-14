import { OrgContext } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Playbook } from '../registry/playbook.ts';
import type { CheckedGoals, PlaybookGoals, PlaybookHeld } from './playbook-goals.ts';

export function heldOn<Held extends Playbook>(playbook: Held, held: PlaybookHeld) {
  return held.page === undefined
    ? { ...playbook, goals: held.goals }
    : { ...playbook, page: { source: held.page.source }, goals: held.goals };
}

export function withItsGoals<Checked extends CheckedGoals, Held extends Playbook>(
  goals: PlaybookGoals<Checked>,
  playbook: Held,
) {
  return Effect.gen(function* () {
    const { org } = yield* OrgContext;
    return heldOn(playbook, yield* goals.read({ org, playbook: playbook.id }));
  });
}
