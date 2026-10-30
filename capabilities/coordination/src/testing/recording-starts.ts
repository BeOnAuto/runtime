import type { Capability } from '@on.auto/definitions';
import type { RunStart, WorkflowHost } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import { makeWorkflowAdapter } from '../capability/workflow.ts';
import { testExpressionCheck } from './expression-checks.ts';
import { testPlaybookNames } from './test-sandbox.ts';

export interface RecordingStarts {
  readonly starts: readonly RunStart[];
  readonly recording: Pick<WorkflowHost, 'start'>;
}

export function recordingStarts(): RecordingStarts {
  const starts: RunStart[] = [];
  const recording: Pick<WorkflowHost, 'start'> = {
    start: (_run, start) =>
      Effect.sync(() => {
        starts.push(start);
        return 'started';
      }),
  };
  return { starts, recording };
}

export function recordingWorkflows(recording: Pick<WorkflowHost, 'start'>): Capability {
  return makeWorkflowAdapter({
    runs: recording,
    check: testExpressionCheck,
    mostDurationMs: 2_592_000_000,
    longestCallMs: 1000,
    names: testPlaybookNames,
  });
}
