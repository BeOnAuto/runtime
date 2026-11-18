import { SQL } from '@event-driven-io/dumbo';
import type { RunIdInAnOrg } from '@on.auto/operations';
import { Schema } from 'effect';

import type { RunIdsStore } from '../definitions/definition-reads.ts';
import type { ReadQuery } from '../scrub/scrubbed-facts.ts';
import { runIds } from './run-ids-table.ts';

const decodeHolders = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ definition_key: Schema.String })));

export async function holderOfRunIdIn(read: ReadQuery, { orgKey, runId }: RunIdInAnOrg): Promise<string | undefined> {
  const rows = await read(SQL`SELECT definition_key FROM ${runIds} WHERE org_key = ${orgKey} AND run_id = ${runId}`);
  return decodeHolders(rows).at(0)?.definition_key;
}

export function runIdsReadOn(read: ReadQuery): RunIdsStore {
  return { holderOfRunId: (claimed) => holderOfRunIdIn(read, claimed) };
}
