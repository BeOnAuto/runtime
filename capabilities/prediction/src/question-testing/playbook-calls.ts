import type { PlaybookOperation } from '@on.auto/definitions';
import { admittingMeter } from '@on.auto/definitions/testing';
import { allPermissions, Ledger, makeDispatcher, type CallerIdentity, type Outcome } from '@on.auto/operations';
import { memoryPlaybookRegistry, recordingReporter, type MemoryLedger } from '@on.auto/operations/testing';
import { Clock, Effect, Layer } from 'effect';

const alpha = { org: 'acme', playbook: 'alpha' } as const;

const owner: CallerIdentity = {
  id: 'acme-admin',
  name: 'acme-admin',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

export type PlaybookCall = (operation: PlaybookOperation, input: object) => Promise<Outcome>;

export function playbookCalls(ledger: MemoryLedger, clock: Clock.Clock): PlaybookCall {
  const services = Layer.mergeAll(
    Layer.succeed(Ledger, ledger.service),
    Layer.succeed(Clock.Clock, clock),
    memoryPlaybookRegistry([alpha]),
    recordingReporter().layer,
    admittingMeter,
  );
  const dispatcher = makeDispatcher([]);
  return (operation, input) =>
    Effect.runPromise(
      dispatcher
        .dispatchToPlaybook(operation.registration, { caller: owner, ...alpha, input, encoding: 'json' })
        .pipe(Effect.provide(services)),
    );
}
