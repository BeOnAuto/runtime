import { streamPrefixOfOrg } from '@on.auto/operations';
import { Effect } from 'effect';

import { RunStartedSchema } from '../runs/run-events.ts';
import { acmeAdmin } from './callers.ts';
import { answerOf, operations, toAlpha, weekly, type Definitions } from './moving.ts';

export async function ranWeekly(definitions: Definitions): Promise<string> {
  const ran = await definitions.call(operations.runDefinition, toAlpha(acmeAdmin, { ...weekly, input: {} }));
  return String(answerOf(ran)['run_id']);
}

export function holderOfTheRun(definitions: Definitions, runId: string): Promise<string | undefined> {
  const orgKey = streamPrefixOfOrg({ org: 'acme' });
  return Effect.runPromise(definitions.ledger.service.holderOfRunId({ orgKey, runId }));
}

export async function playbookItStartedIn(definitions: Definitions, runId: string): Promise<string | undefined> {
  const holder = await holderOfTheRun(definitions, runId);
  const started = await Effect.runPromise(
    definitions.ledger.service.factAt(`${String(holder)}runs/${runId}`, 1, RunStartedSchema),
  );
  return started?.data.playbook;
}
