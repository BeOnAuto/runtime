import { Result } from 'effect';

import { workflowMachine } from '../decider/workflow-machine.ts';
import { mostInputMs } from '../dsl/evaluation.ts';
import { newRun, type RunState } from '../machine/run-state.ts';
import type { MachineSandbox } from '../programs/reserved-instances.ts';
import { evolveRun } from '../run-log/run-fold.ts';
import { decidingWithin, startedOf, testMachineOf } from '../testing/driver-inputs.ts';
import { drivenRunId } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

export function decidedOnce(sandbox: MachineSandbox, source: string, at: number, inputMs = mostInputMs): RunState {
  const document = workflow(source);
  const events = Result.getOrThrow(
    workflowMachine(testMachineOf(decidingWithin(sandbox, inputMs))).decide(
      startedOf({ runId: drivenRunId, document }, at),
      newRun,
    ),
  );
  return events.reduce((state, event) => evolveRun(state, event), newRun);
}
