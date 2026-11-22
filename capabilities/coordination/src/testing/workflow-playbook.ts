import { echo } from '@on.auto/definitions/testing';
import type { Outcome } from '@on.auto/operations';
import { Schema } from 'effect';

import { makeWorkflowAdapter } from '../capability/workflow.ts';
import { connectionsReporting } from './connection-events.ts';
import { testExpressionCheck } from './expression-checks.ts';
import { hostSettlementsOn } from './host-settlements.ts';
import { noneQueued, playbookOn, type Playbook, namingLedger } from './playbook.ts';
import { testHost } from './test-host.ts';
import { testPlaybookNames } from './test-sandbox.ts';

export interface WorkflowPlaybook extends Playbook {
  readonly host: Awaited<ReturnType<typeof testHost>>;
  readonly settled: (runId: string) => Promise<Outcome>;
  readonly close: () => Promise<void>;
}

const mostDurationMs = 2_592_000_000;

const StartedSchema = Schema.Struct({ output: Schema.Struct({ status: Schema.Literal('started') }) });

const isStarted = Schema.is(StartedSchema);

export async function workflowPlaybook({
  goals = false,
  connectionEvents = connectionsReporting({}),
}: {
  readonly goals?: boolean;
  readonly connectionEvents?: Parameters<typeof makeWorkflowAdapter>[0]['connectionEvents'];
} = {}): Promise<WorkflowPlaybook> {
  const ledger = namingLedger();
  const nested = playbookOn(ledger, [echo]);
  const settlements = hostSettlementsOn();
  const host = await testHost(settlements.settling(nested), settlements.clock);
  const playbook = playbookOn(ledger, [
    makeWorkflowAdapter({
      runs: host,
      queued: noneQueued,
      check: testExpressionCheck,
      connectionEvents,
      mostDurationMs,
      longestCallMs: 660_000,
      names: testPlaybookNames,
      goals,
    }),
    echo,
  ]);
  const runOf = (runId: string): Promise<Outcome> => playbook.call(playbook.getRun, { run_id: runId });
  const settled = async (runId: string): Promise<Outcome> => {
    await settlements.settledOn(runId, async () => isStarted(await runOf(runId)));
    return runOf(runId);
  };
  return { ...playbook, host, settled, close: () => host.stop() };
}
