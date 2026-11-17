import type { Caller, Conflict, InvalidInput, Notice, PlaybookAddress, Unavailable } from '@on.auto/operations';
import type { Effect } from 'effect';

import type { PlaybookPage } from '../operations/playbook-pages.ts';
import type { GoalsAnswer } from './goals-answer.ts';

export interface GoalsNaming {
  readonly name: string;
  readonly description?: string;
}

export interface CheckedGoal {
  readonly id: string;
}

export interface CheckedGoals {
  readonly source: string;
  readonly goals: readonly CheckedGoal[];
}

export interface PlaybookHeld {
  readonly page?: PlaybookPage;
  readonly goals: GoalsAnswer;
}

export interface GoalsSaving<Checked extends CheckedGoals> {
  readonly page?: string | null;
  readonly goals?: Checked;
  readonly onlyIfNone?: boolean;
}

export type GoalsSaveOutcome = 'saved' | 'unchanged' | 'already_held';

export interface PlaybookHeldSaved extends PlaybookHeld {
  readonly outcome?: GoalsSaveOutcome;
  readonly awaiting?: boolean;
  readonly notices?: readonly Notice[];
}

export interface PlaybookGoals<Checked extends CheckedGoals = CheckedGoals> {
  readonly messages: boolean;
  readonly check: (source: string, naming: GoalsNaming) => Effect.Effect<Checked, InvalidInput>;
  readonly read: (playbook: PlaybookAddress) => Effect.Effect<PlaybookHeld>;
  readonly save: (
    playbook: PlaybookAddress,
    saving: GoalsSaving<Checked>,
  ) => Effect.Effect<PlaybookHeldSaved, InvalidInput | Unavailable | Conflict, Caller>;
}
