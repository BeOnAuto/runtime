import { nestedRunId } from '@on.auto/definitions';
import { answers, textResult } from '@on.auto/reasoning/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { accountsServed, installation, licensedServedBy } from '../testing/accounts/licensed-server.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize acme.'].join('\n');

const asking = workflowSource(
  'asking',
  'do:\n  - ask: { call: run_definition, with: { type: reasoning, name: summary, input: {} } }\n',
);

const nesting = workflowSource(
  'nesting',
  'do:\n  - nest: { call: run_definition, with: { type: workflow, name: asking } }\n',
);

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

async function historyOf(server: ReasoningServer, runId: string): Promise<readonly string[]> {
  const { body } = await server.call('GET', `${alpha}/runs/${runId}/history`);
  return decodeHistory(body).events.map(({ type }) => type);
}

describe('a workflow of a licensed runtime that calls a workflow that calls a function', () => {
  it('counts one licensed run for each of the three runs, and reports them as it stops, asking Auto nothing for each', async () => {
    const accounts = await accountsServed();
    const server = await licensedServedBy(accounts, { AUTO_RUNTIME_LICENSE_KEY: accounts.key }, {}, [
      answers(textResult('Short.')),
    ]);
    await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'asking', source: asking } });
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'nesting', source: nesting } });
    const started = await server.call('POST', `${alpha}/definitions/workflow/nesting/run`, { body: { input: {} } });
    const settled = await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);
    const nested = nestedRunId(runIdIn(started.body), '/do/0/nest', 1);
    const runs = [runIdIn(started.body), nested, nestedRunId(nested, '/do/0/ask', 1)];
    await server.stop();

    expect(settled).toMatchObject({ body: { status: 'succeeded', output: 'Short.' } });
    expect(runs).toHaveLength(3);
    expect(accounts.account.reports()).toEqual([{ actions: 3, licensed: 3 }]);
  });
});

describe('a workflow of a licensed runtime and the reasoning run it called, resumed by a server started again after the first stopped while the model answered', () => {
  it('counts one licensed run for each run, the resumed attempt nothing more', async () => {
    const accounts = await accountsServed();
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const licensed = { AUTO_RUNTIME_LICENSE_KEY: accounts.key };
    const first = await licensedServedBy(accounts, licensed, { ledger }, [() => Effect.never]);
    await first.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
    await first.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'asking', source: asking } });
    const started = await first.call('POST', `${alpha}/definitions/workflow/asking/run`, { body: { input: {} } });
    await until(
      () => first.modelCalls(),
      (calls) => calls === 1,
    );
    await first.stop();
    const second = await licensedServedBy(accounts, licensed, { ledger }, [answers(textResult('Short.'))]);
    const workflowRun = runIdIn(started.body);
    const settled = await settledRun(second, `${alpha}/runs/${workflowRun}`);
    const called = nestedRunId(workflowRun, '/do/0/ask', 1);
    const history = await historyOf(second, called);
    await second.stop();

    expect(settled).toMatchObject({ body: { status: 'succeeded', output: 'Short.' } });
    expect(history).toEqual([
      'run_started',
      'model_call_started',
      'model_call_failed',
      'model_call_started',
      'model_call_answered',
      'run_succeeded',
    ]);
    expect(accounts.account.reports().at(-1)).toEqual({ actions: 2, licensed: 2 });
    expect(accounts.account.chargedThrough(installation)).toBe(2);
  }, 60_000);
});
