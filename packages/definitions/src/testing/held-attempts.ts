import type { PlaybookRequest } from '@on.auto/operations';
import { recordingReporter } from '@on.auto/operations/testing';
import { Effect } from 'effect';

import { deadAttemptEnder, LiveAttempts, liveAttemptsOf, type RunRefusal } from '../attempts/live-attempts.ts';
import type { Capability } from '../capability/capability.ts';
import type { RunDetail } from '../runs/run.ts';
import { acmeAdmin } from './callers.ts';
import { definitionOperationsFor } from './definition-operations.ts';
import { harness, toPlaybook } from './harness.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const alpha = { org: 'acme', playbook: 'alpha' };

const heldRunId = '0199a3c4-7d2e-7c1a-9b3f-0000000000f2';

interface AProcess {
  readonly live: LiveAttempts['Service'];
  readonly acquired: () => number;
}

export function aProcess(): AProcess {
  const held = { latest: 0 };
  const attempts = Effect.runSync(
    Effect.scoped(liveAttemptsOf<RunDetail, RunRefusal>()).pipe(Effect.provide(recordingReporter().layer)),
  );
  const acquired = (_key: string, fencingToken: number) =>
    Effect.sync(() => {
      held.latest = fencingToken;
    });
  return { live: LiveAttempts.of({ ...attempts, acquired }), acquired: () => held.latest };
}

export async function aRunAClientStarts(capability: Capability, name: string) {
  const operations = definitionOperationsFor([capability]);
  const definitions = harness();
  const { service } = definitions.ledger;
  const defined = { type: capability.type, name, source: name };
  await definitions.call(operations.createDefinition, toAlpha(acmeAdmin, defined));
  const request: PlaybookRequest = toAlpha(acmeAdmin, { type: capability.type, name, input: {}, run_id: heldRunId });
  const lineage = { causationId: null, correlationId: heldRunId };
  const run = { ...alpha, id: heldRunId };
  return {
    runningIn: ({ live }: AProcess) =>
      definitions.run(
        definitions.dispatch(operations.runDefinition, request).pipe(Effect.provideService(LiveAttempts, live)),
      ),
    endingTheAttemptOf: (itsProcess: AProcess) =>
      definitions.run(deadAttemptEnder(service)({ run, lineage, fencingToken: itsProcess.acquired() })),
    reading: () => definitions.call(operations.getRun, toAlpha(acmeAdmin, { run_id: heldRunId })),
    recorded: async () => {
      const read = service.readRecorded(alpha, { kind: 'run', run: heldRunId }, { order: 'asc', limit: 20 });
      const { records } = await definitions.run(Effect.orDie(read));
      return records.map(({ type }) => type);
    },
  };
}
