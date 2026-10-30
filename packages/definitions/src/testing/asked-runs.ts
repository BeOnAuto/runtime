import { Effect, type Result, type Schema } from 'effect';

import { declaredFactsOf, runFactsOf, workRecorder, type Work } from '../index.ts';
import { startedRunOf } from '../runs/run-state.ts';
import { asking } from './asking.ts';
import { acmeAdmin } from './callers.ts';
import { definitionOperationsFor } from './definition-operations.ts';
import { harness, toPlaybook } from './harness.ts';

export const askedRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const askedRun = { org: 'acme', playbook: 'alpha', id: askedRunId };

export const askedStream = `playbook/acme/alpha/runs/${askedRunId}`;

export const askedLineage = { causationId: 'request-1', correlationId: askedRunId };

export const askingFacts = runFactsOf(declaredFactsOf([asking]));

export const question = 'Approve the brief?';

const askedLater = { campaign: 'Spring' };

export function nudge(number: number): Work {
  return { type: 'work', fact: { type: 'nudge_sent', data: { number } } };
}

export function answering(answer: Schema.Json, claimedFor?: string): Work {
  return { type: 'answer', answer: { answer, ...(claimedFor === undefined ? {} : { claimed_for: claimedFor }) } };
}

const toAlpha = toPlaybook('acme', 'alpha');

export async function asked(input: unknown = askedLater) {
  const operations = definitionOperationsFor([asking]);
  const definitions = harness();
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'asking', name: 'approve', source: question }),
  );
  const started = await definitions.call(
    operations.runDefinition,
    toAlpha(acmeAdmin, { type: 'asking', name: 'approve', input, run_id: askedRunId }),
  );
  const { service } = definitions.ledger;
  return {
    ...definitions,
    started,
    record: workRecorder(service, askingFacts),
    recorded: async () =>
      (
        await Effect.runPromise(
          Effect.orDie(service.readRecorded(askedRun, { kind: 'run', run: askedRunId }, { order: 'asc', limit: 20 })),
        )
      ).records,
    state: async () => startedRunOf((await Effect.runPromise(service.load(askedStream, askingFacts.decider))).state),
  };
}

export function attempted<A, E>(effect: Effect.Effect<A, E>): Promise<Result.Result<A, E>> {
  return Effect.runPromise(Effect.result(effect));
}
