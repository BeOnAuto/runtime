import type { ScriptedReply } from '@on.auto/reasoning/testing';
import type { HostClock } from '@on.auto/workflow-host';
import { Schema } from 'effect';

import type { TestResponse } from './http-client.ts';
import { alpha, type ReasoningServer } from './reasoning-server.ts';
import { servingWorkflows, workflowSource } from './workflow-server.ts';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize: {{ input.text }}'].join('\n');

export const impatientTimeoutMs = 500;

function calling(name: string, task: string, indent = '  '): string {
  return `${indent}- ${task}: { call: run_definition, with: { type: workflow, name: ${name} } }\n`;
}

export const workflows: Readonly<Record<string, string>> = {
  asking: "do:\n  - ask: { call: run_definition, with: { type: reasoning, name: summary, input: { text: 'long' } } }\n",
  nesting: `do:\n${calling('asking', 'nest')}`,
  pending: 'do:\n  - hold: { listen: { to: { one: { with: { type: com.acme.go } } } } }\n',
  waiting: `do:\n${calling('pending', 'wait')}`,
  middle: `do:\n${calling('pending', 'wait')}`,
  top: `do:\n${calling('middle', 'wait')}`,
  quick: 'do:\n  - done: { set: { quick: true } }\n',
  deep: `do:\n${calling('deep', 'again')}`,
  guarded: `do:
  - guard:
      try:
${calling('pending', 'wait', '        ')}      catch:
        errors: { with: { type: https://on.auto/problems/cancelled, kind: requested } }
        do:
          - note: { set: { caught: '\${ $error.kind }' } }
`,
  impatient: `do:
  - wait:
      call: run_definition
      with: { type: workflow, name: pending }
      timeout: { after: { milliseconds: ${impatientTimeoutMs} } }
`,
  wide: `do:
  - each:
      fork:
        branches:
${['a', 'b', 'c'].map((branch) => calling('pending', branch, '          ')).join('')}`,
};

async function definedInTurn(server: ReasoningServer, entries: readonly (readonly [string, string])[]): Promise<void> {
  const [entry, ...rest] = entries;
  if (entry !== undefined) {
    const [name, steps] = entry;
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name, source: workflowSource(name, steps) } });
    await definedInTurn(server, rest);
  }
}

export async function servingCalls(
  replies: readonly ScriptedReply[],
  environment: Readonly<Record<string, string>> = {},
  clock?: HostClock,
): Promise<ReasoningServer> {
  const server = await servingWorkflows(replies, environment, undefined, clock);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
  await definedInTurn(server, Object.entries(workflows));
  return server;
}

export function startedRunOf(server: ReasoningServer, name: string): Promise<TestResponse> {
  return server.call('POST', `${alpha}/definitions/workflow/${name}/run`, { body: { input: {} } });
}

const ListedRuns = Schema.Struct({
  runs: Schema.Array(
    Schema.Struct({
      run_id: Schema.String,
      status: Schema.String,
      rejection: Schema.optionalKey(Schema.Struct({ kind: Schema.optionalKey(Schema.String) })),
    }),
  ),
});

export type ListedRun = (typeof ListedRuns.Type)['runs'][number];

const decodeListed = Schema.decodeUnknownSync(ListedRuns);

export async function runsOf(server: ReasoningServer, name: string): Promise<readonly ListedRun[]> {
  const listed = await server.call('GET', `${alpha}/runs?type=workflow&name=${name}&limit=100`);
  return decodeListed(listed.body).runs;
}

export function ended(runs: readonly ListedRun[]): boolean {
  return runs.length > 0 && runs.every(({ status }) => status !== 'started');
}
