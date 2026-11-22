import type { Capability } from '@on.auto/definitions';
import type { QueuedStartReads, RunStart, WorkflowHost } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import { makeWorkflowAdapter } from '../capability/workflow.ts';
import { connectionsReporting } from './connection-events.ts';
import { testExpressionCheck } from './expression-checks.ts';
import { noneQueued } from './playbook.ts';
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

export function recordingWorkflows(
  recording: Pick<WorkflowHost, 'start'>,
  queued: Pick<QueuedStartReads, 'queuedStartsOf'> = noneQueued,
): Capability {
  return makeWorkflowAdapter({
    runs: recording,
    queued,
    check: testExpressionCheck,
    connectionEvents: connectionsReporting({}),
    mostDurationMs: 2_592_000_000,
    longestCallMs: 1000,
    names: testPlaybookNames,
  });
}
