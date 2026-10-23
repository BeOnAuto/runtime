import { playbookOwnNamesOf, defineStartVersion } from '@on.auto/definitions';
import { echo } from '@on.auto/definitions/testing';
import { makeDispatcher } from '@on.auto/operations';
import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import {
  filterSandboxOf,
  freshInstances,
  handedWorkersOf,
  machineSandboxOf,
  programPool,
} from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { memoryRuntime } from '../testing/records/memory-runtime.ts';
import { hostWorkOf } from './host-work.ts';

const unknownRun = { org: 'acme', playbook: 'alpha', id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' };

const lineage = { causationId: 'cancel-1', correlationId: unknownRun.id };

describe('the machine the workflow host decides runs with', () => {
  it("is the coordination's functions, runtime and context of each record on the pool's sandbox, so no setting of the server reaches the machine's bound on tasks without waiting", async () => {
    const runtime = await memoryRuntime();
    const pool = programPool({
      handed: await handedWorkersOf(shippedFilesOnDisk),
      instances: 'fresh',
      workers: 1,
      heapMegabytes: 64,
    });
    const { machine } = hostWorkOf(runtime, makeDispatcher([]), {
      capabilities: [echo],
      startVersion: defineStartVersion([echo]),
      names: playbookOwnNamesOf([echo]),
      evaluations: pool.evaluations,
    });
    await Promise.all([pool.close(), runtime.dispose()]);

    expect(Object.keys(machine).toSorted()).toEqual(['contextOf', 'functions', 'runtime', 'sandbox']);
    expect(machine.sandbox).toBe(pool.evaluations.machine);
    expect(Object.keys(machine.sandbox)).not.toContain('mostStepsWithoutWaiting');
  });
});

describe('the cancels the workflow host hands to the runtime of the server', () => {
  it('settle nothing for a run the ledger does not have, and record the cancel of a run that has not started yet', async () => {
    const runtime = await memoryRuntime();
    const { waiting } = hostWorkOf(runtime, makeDispatcher([]), {
      capabilities: [echo],
      startVersion: defineStartVersion([echo]),
      names: playbookOwnNamesOf([echo]),
      evaluations: {
        machine: machineSandboxOf(freshInstances(shippedFilesOnDisk)),
        filters: filterSandboxOf(freshInstances(shippedFilesOnDisk)),
      },
    });

    const settled = await Effect.runPromise(
      Effect.as(waiting.cancelDeferred(unknownRun, { kind: 'requested', reason: 'No longer needed' }, lineage), 'left'),
    );
    const cancelled = await Effect.runPromise(
      waiting.cancel(unknownRun, { kind: 'parent_ended', reason: 'The run that waited for it ended' }, lineage),
    );
    await runtime.dispose();

    expect([settled, cancelled]).toEqual(['left', 'requested']);
  });
});
