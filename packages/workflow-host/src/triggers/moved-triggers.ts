import { statement } from '@on.auto/ledger';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';

export function triggersMoved(database: HostDatabase, definitionKey: string, playbookKey: string): Effect.Effect<void> {
  return Effect.orDie(
    Effect.forEach(
      [
        statement`UPDATE workflow_subscriptions SET playbook_key = ${playbookKey} WHERE definition_key = ${definitionKey}`,
        statement`UPDATE workflow_subscription_types SET playbook_key = ${playbookKey}
          WHERE definition_key = ${definitionKey}`,
        statement`UPDATE workflow_reaction_refusals SET playbook_key = ${playbookKey}
          WHERE definition_key = ${definitionKey}`,
      ],
      (written) => database.write(written),
      { discard: true },
    ),
  );
}
