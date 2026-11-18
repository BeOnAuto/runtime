import { SQL } from '@event-driven-io/dumbo';
import { runIdClaimsOf, type RunIdClaim, type RunIds } from '@on.auto/operations';

import { readOn } from '../definition-names/name-rows.ts';
import type { StatementExecutor } from '../event-store.ts';
import { inlineRegistrationOf, inTurn, type InlineRegistration } from '../projections/inline-projection.ts';
import { appendRefusedAs } from '../refusals/append-refused.ts';
import { VersionConflict } from '../version-conflict.ts';
import { holderOfRunIdIn } from './run-id-reads.ts';
import { runIds as runIdsTable } from './run-ids-table.ts';

async function holderOf(execute: StatementExecutor, claim: RunIdClaim): Promise<string> {
  const holder = await holderOfRunIdIn(readOn(execute), claim);
  if (holder === undefined) {
    throw new VersionConflict();
  }
  return holder;
}

async function claimed(runIds: RunIds, execute: StatementExecutor, claim: RunIdClaim, stream: string): Promise<void> {
  await execute.command(
    SQL`INSERT INTO ${runIdsTable} (org_key, run_id, definition_key)
      VALUES (${claim.orgKey}, ${claim.runId}, ${claim.definitionKey})
      ON CONFLICT (org_key, run_id) DO NOTHING`,
  );
  if ((await holderOf(execute, claim)) !== claim.definitionKey) {
    throw appendRefusedAs(runIds.heldElsewhere(), stream);
  }
}

interface ClaimOnAStream {
  readonly claim: RunIdClaim;
  readonly stream: string;
}

export function runIdsRegistrations(runIds: RunIds | undefined): readonly InlineRegistration[] {
  if (runIds === undefined) {
    return [];
  }
  return [
    inlineRegistrationOf({
      types: runIds.types,
      handle: (messages, execute) =>
        inTurn(
          messages.flatMap((message) =>
            runIdClaimsOf(runIds, [message]).map((claim): ClaimOnAStream => ({ claim, stream: message.stream })),
          ),
          ({ claim, stream }: ClaimOnAStream) => claimed(runIds, execute, claim, stream),
        ),
    }),
  ];
}
