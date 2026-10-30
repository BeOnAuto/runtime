import {
  defineCreateDefinition,
  defineRunDefinition,
  runSettler,
  getRun,
  type Capability,
  type SettleRun,
} from '@on.auto/definitions';
import { admittingMeter } from '@on.auto/definitions/testing';
import {
  makeDispatcher,
  settle as settleCall,
  type CallerIdentity,
  type Outcome,
  type Registration,
  type Settled,
} from '@on.auto/operations';
import { memoryPlaybookRegistry, recordingReporter, type MemoryLedger } from '@on.auto/operations/testing';
import { Effect, Layer } from 'effect';

import { definitionRunResultOf } from '../calls/function-results.ts';
import type { RunDefinition } from '../calls/function-run.ts';
import { acmeCaller } from './workflows.ts';

interface PlaybookOperation {
  readonly registration: Registration<'playbook'>;
}

export interface Playbook {
  readonly createDefinition: PlaybookOperation;
  readonly runDefinition: PlaybookOperation;
  readonly getRun: PlaybookOperation;
  readonly call: (operation: PlaybookOperation, input: object, caller?: CallerIdentity) => Promise<Outcome>;
  readonly callCancelledWhen: (
    cancelled: Promise<unknown>,
    operation: PlaybookOperation,
    input: object,
  ) => Promise<Settled>;
  readonly executeNested: RunDefinition;
  readonly settle: SettleRun;
}

export function playbookOn(ledger: MemoryLedger, capabilities: readonly Capability[]): Playbook {
  const services = Layer.mergeAll(
    ledger.layer,
    memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }]),
    recordingReporter().layer,
    admittingMeter,
  );
  const dispatcher = makeDispatcher([]);
  const createDefinition = defineCreateDefinition(capabilities);
  const runDefinition = defineRunDefinition(capabilities);
  const dispatch = (operation: PlaybookOperation, input: object, caller: CallerIdentity): Effect.Effect<Outcome> =>
    dispatcher
      .dispatchToPlaybook(operation.registration, { caller, org: 'acme', playbook: 'alpha', input, encoding: 'json' })
      .pipe(Effect.provide(services));
  const call: Playbook['call'] = (operation, input, caller = acmeCaller) =>
    Effect.runPromise(dispatch(operation, input, caller));
  return {
    createDefinition,
    runDefinition,
    getRun,
    call,
    callCancelledWhen: (cancelled, operation, input) => {
      const cancelling = new AbortController();
      void cancelled.then(() => {
        cancelling.abort();
        return cancelling;
      });
      return Effect.runPromise(
        settleCall(dispatch(operation, input, acmeCaller), cancelling.signal).pipe(Effect.provide(services)),
      );
    },
    executeNested: ({ caller, type, name, input, runId }) =>
      dispatch(runDefinition, { type, name, input, run_id: runId }, caller).pipe(Effect.map(definitionRunResultOf)),
    settle: runSettler(ledger.service),
  };
}
