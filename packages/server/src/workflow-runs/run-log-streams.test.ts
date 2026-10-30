import { statement } from '@on.auto/ledger';
import { answers, textResult } from '@on.auto/reasoning/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { readOfTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, servingWorkflows, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const playbookKey = 'playbook/acme/alpha/';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize: {{ input.text }}'].join('\n');

const workflows: Readonly<Record<string, string>> = {
  setting: 'do:\n  - done: { set: { done: true } }\n',
  asking: "do:\n  - ask: { call: run_definition, with: { type: reasoning, name: summary, input: { text: 'long' } } }\n",
  nesting: 'do:\n  - nest: { call: run_definition, with: { type: workflow, name: setting } }\n',
  pausing: 'do:\n  - pause: { wait: { milliseconds: 50 } }\n',
  listening: 'do:\n  - hold: { listen: { to: { one: { with: { type: com.acme.go } } } } }\n',
  telling:
    'do:\n  - tell: { emit: { event: { with: { type: com.acme.told, source: https://acme.example/told, data: { to: ada } } } } }\n',
  forking:
    'do:\n  - both:\n      fork:\n        branches:\n          - a: { set: { a: 1 } }\n          - b: { set: { b: 2 } }\n',
  guarding: `do:
  - guarded:
      try:
        - fail: { raise: { error: { type: https://example.com/errors/busy, status: 503 } } }
      catch:
        errors: { with: { status: 503 } }
        do:
          - recover: { set: { recovered: true } }
`,
};

const FirstMessages = Schema.Array(Schema.Struct({ stream: Schema.String, type: Schema.String }));

type FirstMessage = (typeof FirstMessages.Type)[number];

const decodeFirstMessages = Schema.decodeUnknownSync(FirstMessages);

let server: ReasoningServer;

let ledger: TemporaryLedger;

afterEach(async () => {
  await server.stop();
  ledger.remove();
});

async function firstMessagesOfThePlaybook(): Promise<readonly FirstMessage[]> {
  return decodeFirstMessages(
    await readOfTheLedgerIn(
      ledger.fileName,
      statement`SELECT stream_id AS stream, message_type AS type FROM emt_messages WHERE stream_position = 1 AND substr(stream_id, 1, ${playbookKey.length}) = ${playbookKey}`,
    ),
  );
}

function kindKeyOf(stream: string): string {
  return `${stream.split('/').slice(0, 4).join('/')}/`;
}

function streamsOfKind(messages: readonly FirstMessage[], kind: string): readonly FirstMessage[] {
  return messages.filter(({ stream }) => kindKeyOf(stream) === `${playbookKey}${kind}/`);
}

function holdsTheLogOfEvery(runIds: readonly string[]) {
  return (messages: readonly FirstMessage[]): boolean => {
    const logged = new Set(streamsOfKind(messages, 'run-logs').map(({ stream }) => stream));
    return runIds.every((runId) => logged.has(`${playbookKey}run-logs/${runId}`));
  };
}

async function definedInTurn(entries: readonly (readonly [string, string])[]): Promise<void> {
  const [entry, ...rest] = entries;
  if (entry !== undefined) {
    const [name, steps] = entry;
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name, source: workflowSource(name, steps) } });
    await definedInTurn(rest);
  }
}

async function startedInTurn(names: readonly string[], runIds: readonly string[] = []): Promise<readonly string[]> {
  const [name, ...rest] = names;
  if (name === undefined) {
    return runIds;
  }
  const response = await server.call('POST', `${alpha}/definitions/workflow/${name}/run`, { body: { input: {} } });
  return startedInTurn(rest, [...runIds, runIdIn(response.body)]);
}

describe('the run log of a workflow', () => {
  it('is kept under its own kind, so no stream of the kind of a run begins with an input the engine applied', async () => {
    ledger = temporaryLedger();
    server = await servingWorkflows([answers(textResult('Short.'))], {
      LEDGER_FILE: ledger.fileName,
    });
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
    await definedInTurn(Object.entries(workflows));
    const runIds = await startedInTurn(Object.keys(workflows));

    const messages = await until(firstMessagesOfThePlaybook, holdsTheLogOfEvery(runIds));

    expect(streamsOfKind(messages, 'runs').filter(({ type }) => type === 'input_applied')).toEqual([]);
    expect(streamsOfKind(messages, 'runs').map(({ stream }) => stream)).toEqual(
      expect.arrayContaining(runIds.map((runId) => `${playbookKey}runs/${runId}`)),
    );
    expect(new Set(streamsOfKind(messages, 'run-logs').map(({ type }) => type))).toEqual(new Set(['input_applied']));
  });
});
