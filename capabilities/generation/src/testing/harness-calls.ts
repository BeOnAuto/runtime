import { defineCreateDefinition, defineGetRun, defineRunDefinition, type Capability } from '@on.auto/definitions';
import { admittingMeter, uncheckedPages } from '@on.auto/definitions/testing';
import { allPermissions, makeDispatcher, type CallerIdentity, type Outcome } from '@on.auto/operations';
import { memoryPlaybookRegistry, recordingReporter, type MemoryLedger } from '@on.auto/operations/testing';
import { Clock, Effect, Layer } from 'effect';

export const acmeAdmin: CallerIdentity = {
  id: 'acme-admin',
  name: 'acme-admin',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

export const alpha = { org: 'acme', playbook: 'alpha' };

export function clockAt(at: () => number): Clock.Clock {
  const wall = Clock.Clock.defaultValue();
  return {
    currentTimeMillisUnsafe: () => at(),
    currentTimeMillis: Effect.sync(() => at()),
    currentTimeNanosUnsafe: () => BigInt(at()) * 1_000_000n,
    currentTimeNanos: Effect.sync(() => BigInt(at()) * 1_000_000n),
    monotonicTimeNanosUnsafe: () => 0n,
    monotonicTimeNanos: Effect.succeed(0n),
    sleep: wall.sleep.bind(wall),
  };
}

export interface HarnessCalls {
  readonly define: (name: string, source: string) => Promise<Outcome>;
  readonly run: (name: string, input: unknown, runId: string) => Promise<Outcome>;
  readonly runOf: (runId: string) => Promise<Outcome>;
}

export function callsOn(ledger: MemoryLedger, capability: Capability, now: () => number): HarnessCalls {
  const services = Layer.mergeAll(
    ledger.layer,
    memoryPlaybookRegistry([alpha]),
    recordingReporter().layer,
    Layer.succeed(Clock.Clock, clockAt(now)),
    admittingMeter,
  );
  const dispatcher = makeDispatcher([]);
  const call = (registration: Parameters<typeof dispatcher.dispatchToPlaybook>[0], input: unknown) =>
    Effect.runPromise(
      dispatcher
        .dispatchToPlaybook(registration, { caller: acmeAdmin, ...alpha, input, encoding: 'json' })
        .pipe(Effect.provide(services)),
    );
  const capabilities = [capability];
  return {
    define: (name, source) =>
      call(defineCreateDefinition(capabilities, uncheckedPages).registration, {
        type: 'generation',
        name,
        source,
        diagram: 'none',
      }),
    run: (name, input, runId) =>
      call(defineRunDefinition(capabilities).registration, { type: 'generation', name, input, run_id: runId }),
    runOf: (runId) => call(defineGetRun(capabilities, uncheckedPages).registration, { run_id: runId }),
  };
}
