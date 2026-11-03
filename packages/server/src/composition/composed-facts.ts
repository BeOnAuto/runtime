import type { AppRuntime } from '@on.auto/api';
import { workflowFacts } from '@on.auto/coordination';
import {
  playbookOwnNamesOf,
  composedFactsOf,
  inTheDirectoryListing,
  runFactsOf,
  workRecorder,
  type PlaybookOwnNames,
  type Capability,
  type CapabilityFacts,
  type RecordWork,
} from '@on.auto/definitions';
import type { DispatcherServices } from '@on.auto/operations';

import { runtimeLedger } from './runtime-ledger.ts';

export interface ComposedFacts {
  readonly facts: CapabilityFacts;
  readonly names: PlaybookOwnNames;
  readonly record: RecordWork;
}

export function factsComposedOf(
  runtime: AppRuntime<DispatcherServices>,
  capabilities: readonly Capability[],
): ComposedFacts {
  const declarations = [...capabilities, workflowFacts];
  const facts = composedFactsOf(declarations);
  return {
    facts,
    names: playbookOwnNamesOf(declarations, facts),
    record: workRecorder(runtimeLedger(runtime), runFactsOf(facts.onRuns)),
  };
}

export function directoryFactsOf(capabilities: readonly Capability[]): Pick<ComposedFacts, 'facts' | 'names'> {
  const declarations = [...inTheDirectoryListing(capabilities), workflowFacts];
  const facts = composedFactsOf(declarations);
  return { facts, names: playbookOwnNamesOf(declarations, facts) };
}
