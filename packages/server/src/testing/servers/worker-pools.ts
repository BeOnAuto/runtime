import { computationBounds } from '@on.auto/computation';
import { checkingWithoutADeadline, measuredPoolSettings } from '@on.auto/definitions/testing';
import { pageFiltersOn, programPool, type PageFilters, type ProgramPool } from '@on.auto/workflow-engine/dsl';
import { scriptedPool, type PoolOutcome } from '@on.auto/workflow-engine/testing';
import { threadPool } from '@on.auto/workflow-engine/thread-pool';
import { afterAll } from 'vitest';

import type { ProgramPoolOf } from '../../composition/served-computation.ts';
import { somethingHappened } from '../waiting/happenings.ts';

/** A clock that never comes due: no moment read on it is ever past. */
function neverDue(): number {
  return Number.POSITIVE_INFINITY;
}

/**
 * The pool, deciding each input of a workflow with no deadline on its expressions: the machine reads the moment an
 * input began on a clock that never comes due, so a loaded runner never ends a decision for the time it took. Its
 * work budget still bounds it. The deadline itself is workflow-engine's rule, proven there on a ticking clock with the
 * patience as a parameter.
 */
function decidingWithoutADeadline(pool: ProgramPool): ProgramPool {
  const { machine } = pool.evaluations;
  return { ...pool, evaluations: { ...pool.evaluations, machine: { ...machine, clock: neverDue } } };
}

/** The pool, telling the waiting tests each time a job of it ends: a fold into a view, a program, a check. */
function toldOfJobs(pool: ProgramPool): ProgramPool {
  return {
    ...pool,
    run: (request, signal) => pool.run(request, signal).finally(somethingHappened),
    fold: (request, signal) => pool.fold(request, signal).finally(somethingHappened),
    check: (request, signal) => pool.check(request, signal).finally(somethingHappened),
  };
}

/**
 * The pool a test server runs programs in by default: the server's own pool, its slots, budgets, folds, checks and
 * recycling, on the test's own thread rather than worker threads, so no test starts a thread. The worker threads
 * themselves are workflow-engine's subject, proven by its contract test on both pools, and the server's own
 * composition, which `startServer` tests run, starts them.
 */
export const patientThreadPool: ProgramPoolOf = ({ workers }, handed) =>
  toldOfJobs(
    decidingWithoutADeadline(
      checkingWithoutADeadline(
        threadPool({ workers, heapMegabytes: computationBounds.heapMegabytes, handed, instances: 'fresh' }),
      ),
    ),
  );

export function scriptedWorkerPool(...outcomes: readonly PoolOutcome[]): ProgramPoolOf {
  return (settings, handed) => scriptedPool(outcomes, patientThreadPool(settings, handed));
}

interface PooledPorts {
  readonly pool: ProgramPool;
  readonly filters: PageFilters;
}

export function sharedPooledPorts(): PooledPorts {
  const pool = programPool({ workers: 1, heapMegabytes: 256, ...measuredPoolSettings });
  afterAll(() => pool.close());
  return { pool, filters: pageFiltersOn(pool.evaluations.filters) };
}
