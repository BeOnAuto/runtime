import { statement, type Statement } from '@on.auto/ledger';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';

export const notTakenReasons = [
  'playbook_retired',
  'no_trigger',
  'topic_mismatch',
  'invalid_event',
  'automatic_not_asked',
  'filtered',
  'filter_failed',
] as const;

export type NotTakenReason = (typeof notTakenReasons)[number];

export interface TriggerOutcome {
  readonly definitionKey: string;
  readonly reference: string;
  readonly reason: Exclude<NotTakenReason, 'playbook_retired'>;
}

export const triggerOutcomeTables: readonly Statement[] = [
  statement`CREATE TABLE IF NOT EXISTS workflow_trigger_outcomes (
    playbook_key TEXT NOT NULL,
    definition_key TEXT NOT NULL,
    trigger_reference TEXT NOT NULL,
    reason TEXT NOT NULL,
    count BIGINT NOT NULL,
    last_at BIGINT NOT NULL,
    PRIMARY KEY (playbook_key, definition_key, trigger_reference, reason)
  )`,
];

export function beforeAnyTrigger(reason: TriggerOutcome['reason']): TriggerOutcome {
  return { definitionKey: '', reference: '', reason };
}

function countedStatement(playbookKey: string, { definitionKey, reference, reason }: TriggerOutcome, at: number) {
  return statement`INSERT INTO workflow_trigger_outcomes
      (playbook_key, definition_key, trigger_reference, reason, count, last_at)
    VALUES (${playbookKey}, ${definitionKey}, ${reference}, ${reason}, 1, ${at})
    ON CONFLICT (playbook_key, definition_key, trigger_reference, reason) DO UPDATE SET
      count = workflow_trigger_outcomes.count + 1,
      last_at = CASE WHEN excluded.last_at > workflow_trigger_outcomes.last_at
        THEN excluded.last_at ELSE workflow_trigger_outcomes.last_at END`;
}

export function outcomesCounted(
  database: HostDatabase,
  playbookKey: string,
  outcomes: readonly TriggerOutcome[],
  at: number,
): Effect.Effect<void> {
  return Effect.asVoid(
    Effect.orDie(database.transaction(outcomes.map((outcome) => countedStatement(playbookKey, outcome, at)))),
  );
}
