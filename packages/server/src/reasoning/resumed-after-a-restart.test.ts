import { nestedRunId } from '@on.auto/definitions';
import { fakeStdioServerPath, serveFakeMcp } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';

import { shutdownTimeoutMs } from '../lifecycle/shutdown.ts';
import { gatewayThatHangsAfterATool } from '../testing/processes/tool-gateway.ts';
import { requestTo, settledOver, workflowProcess } from '../testing/processes/workflow-process.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { runIdIn, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

const apiKey = 'graph-api-key-4f1d9a7c2b';

const summary = ['---', 'model: stub/writer', 'tools: [graph/search]', '---', 'Summarize acme.'].join('\n');

const summarizing = workflowSource(
  'summarizing',
  'do:\n  - summarize: { call: run_definition, with: { type: reasoning, name: summary, input: {} } }\n',
);

const stillRunning: unknown = expect.stringMatching(/^The run is still running/u);

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

type Starting = (port: number, playbook: string) => Promise<string>;

const throughAWorkflow: Starting = async (port, playbook) => {
  await requestTo(port, 'POST', `/${playbook}/definitions/workflow`, { name: 'summarizing', source: summarizing });
  const started = await requestTo(port, 'POST', `/${playbook}/definitions/workflow/summarizing/run`, { input: {} });
  return runIdIn(started.body);
};

const reasoningRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const byItself: Starting = (port, playbook) => {
  const run = { input: {}, run_id: reasoningRun };
  void requestTo(port, 'POST', `/${playbook}/definitions/reasoning/summary/run`, run).catch(() => 'gone');
  return Promise.resolve(reasoningRun);
};

async function killedWhileItCalledItsModel(playbook: string, recordContent: boolean, starting: Starting) {
  const gateway = await gatewayThatHangsAfterATool();
  const graph = await serveFakeMcp({ bearer: apiKey });
  onTestFinished(graph.close);
  const environment = {
    MODEL_GATEWAYS: gateway.gateways,
    GRAPH_API_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({
      graph: {
        url: graph.url,
        headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' },
        org: 'acme',
        record_content: recordContent,
      },
    }),
  };
  const first = workflowProcess(ledger.fileName, environment);
  const port = await first.port;
  await requestTo(port, 'POST', '', { playbook, name: 'Resuming' });
  await requestTo(port, 'POST', `/${playbook}/definitions/reasoning`, { name: 'summary', source: summary });
  const startedRun = await starting(port, playbook);
  await gateway.secondHeard;
  first.signal('SIGKILL');
  await first.exited;
  return { gateway, graph, environment, startedRun };
}

async function startedAgain(playbook: string, recordContent: boolean) {
  const killed = await killedWhileItCalledItsModel(playbook, recordContent, throughAWorkflow);
  const second = workflowProcess(ledger.fileName, killed.environment);
  const port = await second.port;
  const settled = await settledOver(port, `/${playbook}/runs/${killed.startedRun}`);
  const called = nestedRunId(killed.startedRun, '/do/0/summarize', 1);
  const history = await requestTo(port, 'GET', `/${playbook}/runs/${called}/history`);
  second.signal('SIGTERM');
  await second.exited;
  return { ...killed, settled, history: decodeHistory(history.body).events.map(({ type }) => type) };
}

describe('a reasoning run a workflow called, whose server was killed while the run called its model', () => {
  it('goes on from its facts once the workflow resumes, making again only the call that had no answer', async () => {
    const { settled, history, gateway, graph } = await startedAgain('alpha', true);

    expect(settled).toMatchObject({ status: 'succeeded', output: 'Acme has 2 rows.' });
    expect(history).toEqual([
      'run_started',
      'model_call_started',
      'model_call_answered',
      'tool_call_started',
      'tool_call_answered',
      'model_call_started',
      'model_call_failed',
      'model_call_started',
      'model_call_answered',
      'run_succeeded',
    ]);
    expect(graph.received()).toHaveLength(1);
    expect(gateway.bodies()[2]).toBe(gateway.bodies()[1]);
  });

  it('ends, saying the server restarted, when the playbook keeps no content of its calls', async () => {
    const { settled, graph } = await startedAgain('beta', false);

    expect(settled).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'unavailable', kind: 'tools_unfinished', because: 'restarted_without_content' },
    });
    expect(graph.received()).toHaveLength(1);
  });
});

describe('a reasoning run whose server was killed while the run called its model, asked for again at once', () => {
  it('is refused as still running, since its facts are newer than the longest a call of it may take', async () => {
    const killed = await killedWhileItCalledItsModel('gamma', true, byItself);
    const second = workflowProcess(ledger.fileName, killed.environment);
    const port = await second.port;
    const asked = await requestTo(port, 'POST', '/gamma/definitions/reasoning/summary/run', {
      input: {},
      run_id: killed.startedRun,
    });
    second.signal('SIGTERM');
    await second.exited;

    expect(asked).toMatchObject({
      status: 409,
      body: { kind: 'taken', detail: stillRunning },
    });
  });
});

const sleeping = ['---', 'model: stub/writer', 'tools: [graph/sleep]', '---', 'Wait for acme.'].join('\n');

const historyOf = (port: number) => requestTo(port, 'GET', `/delta/runs/${reasoningRun}/history`);

function typesIn({ body }: { readonly body: unknown }): readonly string[] {
  return decodeHistory(body).events.map(({ type }) => type);
}

describe('a reasoning run whose server stops while the run calls a tool', () => {
  it('interrupts the call before the tool server is stopped, records no end of it, and leaves the run started at once', async () => {
    const gateway = await gatewayThatHangsAfterATool({ name: 'graph__sleep', arguments: '{"ms":60000}' });
    const environment = {
      MODEL_GATEWAYS: gateway.gateways,
      TOOL_SERVERS: JSON.stringify({
        graph: { command: process.execPath, args: [fakeStdioServerPath()], org: 'acme' },
      }),
    };
    const first = workflowProcess(ledger.fileName, environment);
    const port = await first.port;
    await requestTo(port, 'POST', '', { playbook: 'delta', name: 'Stopping' });
    await requestTo(port, 'POST', '/delta/definitions/reasoning', { name: 'waiting', source: sleeping });
    const asked = requestTo(port, 'POST', '/delta/definitions/reasoning/waiting/run', {
      input: {},
      run_id: reasoningRun,
    });
    await until(
      () => historyOf(port),
      (history) => typesIn(history).includes('tool_call_started'),
    );
    const signalled = performance.now();
    first.signal('SIGTERM');
    await first.exited;
    const stoppedInMs = performance.now() - signalled;
    const second = workflowProcess(ledger.fileName, environment);
    const history = await historyOf(await second.port);
    second.signal('SIGTERM');
    await second.exited;

    expect(typesIn(history)).toEqual(['run_started', 'model_call_started', 'model_call_answered', 'tool_call_started']);
    const stopping: unknown = expect.objectContaining({ detail: 'The server is stopping' });

    expect([await asked, stoppedInMs < shutdownTimeoutMs]).toEqual([{ status: 503, body: stopping }, true]);
  });
});
