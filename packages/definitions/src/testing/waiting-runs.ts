import { playbookCallerOf, type PlaybookRequest } from '@on.auto/operations';
import { Effect } from 'effect';

import { defineGoOnWithRun, type Capability } from '../index.ts';
import { runDecider } from '../runs/run-decider.ts';
import { acmeAdmin } from './callers.ts';
import { waitedFor, waiter, type WaiterOptions } from './capabilities/waiter.ts';
import { definitionOperationsFor } from './definition-operations.ts';
import { harness, toPlaybook } from './harness.ts';
import { momentAfter, stream } from './resumed-runs.ts';
import { testRunId } from './run-facts.ts';

export const toAlpha = toPlaybook('acme', 'alpha');

export const thePlaybook = playbookCallerOf({ org: 'acme', playbook: 'alpha' });

export const asThePlaybook = toAlpha(thePlaybook, { run_id: testRunId });

type Definitions = ReturnType<typeof harness>;

function answering(definitions: Definitions) {
  return (approved: boolean, at = momentAfter(60_000)) =>
    definitions.run(
      Effect.orDie(
        definitions.ledger.service.execute(stream, runDecider, {
          type: 'answer',
          answer: { answer: { approved }, answered_by: { id: waitedFor, name: 'Priya' } },
          runId: testRunId,
          by: waitedFor,
          at,
        }),
      ),
      at,
    );
}

function cancelling(definitions: Definitions) {
  return (at: string) =>
    definitions.run(
      Effect.orDie(
        definitions.ledger.service.execute(stream, runDecider, {
          type: 'cancel',
          kind: 'requested',
          reason: 'Stopped by its caller',
          runId: testRunId,
          by: acmeAdmin.id,
          at,
        }),
      ),
    );
}

type StartedBy = Pick<PlaybookRequest, 'caller' | 'actsFor'>;

const startedByAnAdmin: StartedBy = { caller: acmeAdmin };

export async function aWaitingRun(
  options: WaiterOptions = {},
  capabilities: (waiting: Capability) => readonly Capability[] = (waiting) => [waiting],
  startedBy: StartedBy = startedByAnAdmin,
) {
  const waiting = waiter(options);
  const operations = definitionOperationsFor([waiting]);
  const definitions = harness();
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'waiter', name: 'step', source: 'waits' }),
  );
  const started = await definitions.call(operations.runDefinition, {
    ...toAlpha(startedBy.caller, { type: 'waiter', name: 'step', input: {}, run_id: testRunId }),
    ...startedBy,
  });
  const goOn = defineGoOnWithRun(capabilities(waiting));
  const goneOn = (at: string) => definitions.call(goOn, asThePlaybook, at);
  const answered = answering(definitions);
  const cancelled = cancelling(definitions);
  return { ...definitions, ...operations, started, answered, cancelled, goneOn, goOn };
}
