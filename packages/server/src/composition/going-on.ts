import type { AppRuntime } from '@on.auto/api';
import { defineGoOnWithRun, type Capability } from '@on.auto/definitions';
import type { GoOn } from '@on.auto/interaction';
import { makeDispatcher, playbookCallerOf, type DispatcherServices } from '@on.auto/operations';
import { Effect } from 'effect';

import { inRuntime } from '../workflows/in-runtime.ts';

export class RunNotGoneOn extends Error {}

export function goingOnIn(runtime: AppRuntime<DispatcherServices>, capabilities: readonly Capability[]): GoOn {
  const dispatcher = makeDispatcher([]);
  const goOnWithRun = defineGoOnWithRun(capabilities);
  return ({ org, playbook, id }, lineage) =>
    Effect.flatMap(
      inRuntime(
        runtime,
        dispatcher.dispatchToPlaybook(goOnWithRun.registration, {
          caller: playbookCallerOf({ org, playbook }),
          org,
          playbook,
          input: { run_id: id },
          encoding: 'json',
          lineage,
        }),
      ),
      (outcome) =>
        outcome.status === 'succeeded'
          ? Effect.void
          : Effect.fail(new RunNotGoneOn(`The run ${id} did not go on after its request: ${outcome.status}`)),
    );
}
