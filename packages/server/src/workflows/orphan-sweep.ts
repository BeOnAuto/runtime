import type { AppRuntime } from '@on.auto/api';
import { LedgerChores } from '@on.auto/ledger';
import { choreWork, type DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import { inRuntime } from './in-runtime.ts';

export async function orphansSweptIn(runtime: AppRuntime<LedgerChores>): Promise<DueWork> {
  const { sweepOrphans } = await Effect.runPromise(inRuntime(runtime, Effect.service(LedgerChores)));
  return choreWork({ name: 'orphaned content', perform: sweepOrphans });
}
