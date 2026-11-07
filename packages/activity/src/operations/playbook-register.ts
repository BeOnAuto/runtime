import { OrgReader, type Fold } from '@on.auto/operations';
import { PlaybookEventSchema, playbooksStream } from '@on.auto/playbooks';
import { Effect } from 'effect';

import { playbookChangeKeyOf } from '../positions/activity-addresses.ts';
import { millisecondsOf } from '../projections/activity-facts.ts';
import type { ActivityRow } from './activity-row.ts';

export const mostPlaybookChanges = 100;

type PlaybookFact = typeof PlaybookEventSchema.Type;

export interface PlaybookRegister {
  readonly active: ReadonlySet<string>;
  readonly known: ReadonlySet<string>;
  readonly changes: readonly ActivityRow[];
}

const emptyRegister: PlaybookRegister = { active: new Set(), known: new Set(), changes: [] };

function changeOf(fact: PlaybookFact): ActivityRow | undefined {
  if (fact.type === 'playbook_retired' || fact.type === 'playbook_restored') {
    return undefined;
  }
  const at = millisecondsOf(fact.context.at);
  return {
    kind: 'new',
    form: 'playbook',
    position: { at, playbook: fact.data.playbook, key: playbookChangeKeyOf(at) },
    by: fact.type === 'playbook_created' ? fact.data.created_by.id : fact.context.by,
    by_name: null,
    change: fact.type === 'playbook_created' ? 'created' : 'updated',
    trigger: null,
    definition: null,
    run_id: null,
    output_shape: null,
    message: null,
    answer_schema: null,
    detail: null,
    status: null,
    waits_on: null,
    expires_at: null,
    about: null,
  };
}

function activeAfter(active: ReadonlySet<string>, fact: PlaybookFact): ReadonlySet<string> {
  const after = new Set(active);
  if (fact.type === 'playbook_created' || fact.type === 'playbook_restored') {
    after.add(fact.data.playbook);
  }
  if (fact.type === 'playbook_retired') {
    after.delete(fact.data.playbook);
  }
  return after;
}

const registerFold: Fold<PlaybookRegister, PlaybookFact> = {
  initialState: emptyRegister,
  evolve: (register, fact) => {
    const change = changeOf(fact);
    return {
      active: activeAfter(register.active, fact),
      known: new Set([...register.known, fact.data.playbook]),
      changes: change === undefined ? register.changes : [...register.changes, change].slice(-mostPlaybookChanges),
    };
  },
  eventSchema: PlaybookEventSchema,
};

export const loadPlaybookRegister: Effect.Effect<PlaybookRegister, never, OrgReader> = Effect.gen(function* () {
  const { state } = yield* (yield* OrgReader).load(playbooksStream, registerFold);
  return state;
});
