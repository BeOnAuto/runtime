import type { ContentStore } from '@on.auto/content';
import { Effect, type Schema } from 'effect';

import { modelCallSent } from '../journal-testing/model-calls.ts';
import { runDecider } from '../runs/run-decider.ts';
import { acmeAdmin } from './callers.ts';
import { resumer } from './capabilities/resumer.ts';
import { definitionOperationsFor } from './definition-operations.ts';
import { harness, toPlaybook } from './harness.ts';
import { keptArmOf, keptIn, keptLongBeforeAndLost, recordedAsGiven } from './kept-payloads.ts';
import { acted, startOfTheStep, stream } from './resumed-runs.ts';

export interface KeptInput {
  readonly input: Schema.Json;
  readonly held: boolean;
  readonly store: ContentStore;
}

const toAlpha = toPlaybook('acme', 'alpha');

export async function leftWithItsInputKept({ input, held, store }: KeptInput) {
  const resuming = resumer();
  const operations = definitionOperationsFor([resuming.capability]);
  const definitions = harness(undefined, store);
  const { service } = definitions.ledger;
  const defining = (source: string, operation = operations.createDefinition) =>
    definitions.call(operation, toAlpha(acmeAdmin, { type: 'resumer', name: 'step', source }));
  const { sha256, bytes } = keptArmOf(input);
  const { started_by, calls_tools, resumes } = startOfTheStep;
  const context = { ...acted, definitionType: 'resumer', definitionName: 'step', definitionVersion: 1 };
  const data = { input_sha256: sha256, input_bytes: bytes, started_by, calls_tools, resumes };
  const call = { type: 'model_call_started', data: { number: 1, ...modelCallSent() } } as const;
  const alpha = { org: 'acme', playbook: 'alpha' };
  await defining('first');
  await definitions.run(
    Effect.all([
      held ? keptIn(service.content, alpha, input) : keptLongBeforeAndLost(service.content, store, alpha, input),
      recordedAsGiven(service, stream, [{ type: 'run_started', data }], context),
      Effect.orDie(service.execute(stream, runDecider, { type: 'call', fact: call, ...acted })),
    ]),
  );
  await defining('second', operations.updateDefinition);
  const running = (at: string) =>
    definitions.call(
      operations.runDefinition,
      toAlpha(acmeAdmin, { type: 'resumer', name: 'step', input, run_id: acted.runId }),
      at,
    );
  return { ...definitions, resuming, running };
}
