import { nestedRunId } from '@on.auto/definitions';
import { answers, callingTools, type ScriptedReplies, textResult } from '@on.auto/reasoning/testing';
import { fakeStdioServerPath, serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { gatewayThatAsksForATool, requestTo, workflowProcess } from '../testing/processes/workflow-process.ts';
import { ledgerLeftByAKill } from '../testing/records/ledger-left-by-a-kill.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import {
  givenGoals,
  heldAnswerOn,
  runIdIn,
  settledAsSwept,
  steppedServerClock,
  type SteppedServerClock,
  whenHeld,
  workflowSource,
} from '../testing/servers/workflow-server.ts';

/*
 * Servers in the process over one ledger file of the test: what the first leaves on the file is what the second reads,
 * as a server started again would. A kill is the ledger the first leaves at that moment (`ledgerLeftByAKill`), so no
 * finalizer of it reaches the ledger the second reads; a stop is the server's own shutdown.
 */
function ledgerOfTheTest(): TemporaryLedger {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return ledger;
}

const apiKey = 'graph-api-key-4f1d9a7c2b';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/search]', '---', 'Summarize acme.'].join(
  '\n',
);

const summarizing = workflowSource(
  'summarizing',
  'do:\n  - summarize: { call: run_definition, with: { type: reasoning, name: summary, input: {} } }\n',
);

const stillRunning: unknown = expect.stringMatching(/^The run is still running/u);

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

function typesIn({ body }: { readonly body: unknown }): readonly string[] {
  return decodeHistory(body).events.map(({ type }) => type);
}

interface Serving {
  readonly server: ReasoningServer;
  readonly clock: SteppedServerClock;
}

/** A server over the ledger, on a stepped clock that starts where the given one stands: time goes on over a restart. */
async function servedOver(
  ledger: TemporaryLedger,
  environment: Readonly<Record<string, string>>,
  replies: (clock: SteppedServerClock) => readonly ScriptedReplies[],
  after?: SteppedServerClock,
): Promise<Serving> {
  const clock = steppedServerClock(after?.now());
  const server = await servingReasoning(replies(clock), environment, undefined, { ledger, clock });
  onTestFinished(server.stop);
  return { server, clock };
}

type Starting = (server: ReasoningServer, playbook: string) => Promise<string>;

const throughAWorkflow: Starting = async (server, playbook) => {
  const path = `/v1/orgs/acme/playbooks/${playbook}`;
  await server.call('POST', `${path}/definitions/workflow`, { body: { name: 'summarizing', source: summarizing } });
  const started = await server.call('POST', `${path}/definitions/workflow/summarizing/run`, { body: { input: {} } });
  return runIdIn(started.body);
};

const reasoningRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const byItself: Starting = (server, playbook) => {
  const run = { input: {}, run_id: reasoningRun };
  void server.call('POST', `/v1/orgs/acme/playbooks/${playbook}/definitions/reasoning/summary/run`, { body: run });
  return Promise.resolve(reasoningRun);
};

const searchedThenHeld = (clock: SteppedServerClock): readonly ScriptedReplies[] => [
  callingTools([['graph__search', { query: 'acme' }]], () => heldAnswerOn(clock)),
];

async function killedWhileItCalledItsModel(playbook: string, recordContent: boolean, starting: Starting) {
  const ledger = ledgerOfTheTest();
  const graph = await serveFakeMcp({ bearer: apiKey });
  onTestFinished(graph.close);
  const environment = {
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
  const first = await servedOver(ledger, environment, searchedThenHeld);
  await first.server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook, name: 'Resuming' } });
  await first.server.call('POST', `/v1/orgs/acme/playbooks/${playbook}/definitions/reasoning`, {
    body: { name: 'summary', source: summary, diagram: 'none' },
  });
  const startedRun = await starting(first.server, playbook);
  await whenHeld(first.server.modelCalls, (calls) => calls === 2);
  const left = ledgerLeftByAKill(ledger);
  await first.server.stop();
  return { left, graph, environment, first, startedRun };
}

async function startedAgain(playbook: string, recordContent: boolean) {
  const killed = await killedWhileItCalledItsModel(playbook, recordContent, throughAWorkflow);
  const second = await servedOver(
    killed.left,
    killed.environment,
    () => [answers(textResult('Acme has 2 rows.'))],
    killed.first.clock,
  );
  const path = `/v1/orgs/acme/playbooks/${playbook}/runs`;
  const settled = await settledAsSwept(second.server, second.clock, `${path}/${killed.startedRun}`);
  const called = nestedRunId(killed.startedRun, '/do/0/summarize', 1);
  const history = await second.server.call('GET', `${path}/${called}/history`);
  return { ...killed, second, settled: settled.body, history: typesIn(history) };
}

describe('a reasoning run a workflow called, whose server was killed while the run called its model', () => {
  it('goes on from its facts once the workflow resumes, making again only the call that had no answer', async () => {
    const { settled, history, graph, first, second } = await startedAgain('alpha', true);

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
    expect(second.server.modelRequests()).toEqual([first.server.modelRequests()[1]]);
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
    const second = await servedOver(killed.left, killed.environment, () => [], killed.first.clock);
    const asked = await second.server.call('POST', '/v1/orgs/acme/playbooks/gamma/definitions/reasoning/summary/run', {
      body: { input: {}, run_id: killed.startedRun },
    });

    expect(asked).toMatchObject({
      status: 409,
      body: { kind: 'taken', detail: stillRunning },
    });
  });
});

const sleeping = ['---', 'model: stub/writer', 'tools: [graph/sleep]', '---', 'Wait for acme.'].join('\n');

const stoppedRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const historyOf = (port: number) => requestTo(port, 'GET', `/delta/runs/${stoppedRun}/history`);

const sleepAsked = { name: 'graph__sleep', arguments: '{"ms":60000}' };

/*
 * The one case on processes of their own: the tool server here is a process the server starts over stdio, and stops
 * as it shuts down, after the call to it was interrupted; and main, unlike a server in the process, runs its tool
 * calls on the system's clock.
 */
describe('a reasoning run whose server stops while the run calls a tool', () => {
  it('interrupts the call before the tool server is stopped, records no end of it, and leaves the run started at once, for the next server to resume', async () => {
    const ledger = ledgerOfTheTest();
    const environment = {
      MODEL_GATEWAYS: await gatewayThatAsksForATool(sleepAsked),
      TOOL_SERVERS: JSON.stringify({
        graph: { command: process.execPath, args: [fakeStdioServerPath()], org: 'acme' },
      }),
    };
    const first = workflowProcess(ledger.fileName, environment);
    const port = await first.port;
    await requestTo(port, 'POST', '', { playbook: 'delta', name: 'Stopping', goals: givenGoals });
    await requestTo(port, 'POST', '/delta/definitions/reasoning', {
      name: 'waiting',
      source: sleeping,
      diagram: 'none',
    });
    const asked = requestTo(port, 'POST', '/delta/definitions/reasoning/waiting/run', {
      input: {},
      run_id: stoppedRun,
    });
    await whenHeld(
      () => historyOf(port),
      (history) => typesIn(history).includes('tool_call_started'),
    );
    first.signal('SIGTERM');
    await first.exited;
    const second = workflowProcess(ledger.fileName, environment);
    const history = await historyOf(await second.port);
    second.signal('SIGTERM');
    await second.exited;

    const types = typesIn(history);

    expect(types.slice(0, 4)).toEqual([
      'run_started',
      'model_call_started',
      'model_call_answered',
      'tool_call_started',
    ]);
    expect([undefined, 'attempt_resumed']).toContain(types[4]);
    const stopping: unknown = expect.objectContaining({ detail: 'The server is stopping' });

    // Answered at all, the request was ended by the interrupted call: a request still running at the shutdown timeout
    // is cut off unanswered, as `shutdown.test.ts` proves.
    expect(await asked).toEqual({ status: 503, body: stopping });
  });
});
