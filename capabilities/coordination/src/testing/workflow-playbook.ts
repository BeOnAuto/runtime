import { echo } from '@on.auto/definitions/testing';
import type { Outcome } from '@on.auto/operations';
import { Schema } from 'effect';
import { expect, vi } from 'vitest';

import { makeWorkflowAdapter } from '../capability/workflow.ts';
import { connectionsReporting } from './connection-events.ts';
import { testExpressionCheck } from './expression-checks.ts';
import { playbookOn, type Playbook, namingLedger } from './playbook.ts';
import { testHost } from './test-host.ts';
import { testPlaybookNames } from './test-sandbox.ts';

export interface WorkflowPlaybook extends Playbook {
  readonly host: Awaited<ReturnType<typeof testHost>>;
  readonly settled: (runId: string) => Promise<Outcome>;
  readonly close: () => Promise<void>;
}

const mostDurationMs = 2_592_000_000;

const longerThanTheTestMs = 120_000;

const StartedSchema = Schema.Struct({ output: Schema.Struct({ status: Schema.Literal('started') }) });

const isStarted = Schema.is(StartedSchema);

export async function workflowPlaybook({
  goals = false,
}: { readonly goals?: boolean } = {}): Promise<WorkflowPlaybook> {
  const ledger = namingLedger();
  const nested = playbookOn(ledger, [echo]);
  const host = await testHost(nested);
  const playbook = playbookOn(ledger, [
    makeWorkflowAdapter({
      runs: host,
      check: testExpressionCheck,
      connectionEvents: connectionsReporting({}),
      mostDurationMs,
      longestCallMs: 660_000,
      names: testPlaybookNames,
      goals,
    }),
    echo,
  ]);
  const settled = (runId: string): Promise<Outcome> =>
    vi.waitFor(
      async () => {
        const outcome = await playbook.call(playbook.getRun, { run_id: runId });
        expect(isStarted(outcome)).toBe(false);
        return outcome;
      },
      { timeout: longerThanTheTestMs, interval: 10 },
    );
  return { ...playbook, host, settled, close: () => host.stop() };
}
