import { agentDelivery, approvalDocument } from '@on.auto/interaction/testing';
import { Schema } from 'effect';

import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

export const tallySource = (note: string) =>
  [
    '---',
    'language: typescript',
    'input:',
    '  schema: {type: object, properties: {fail: {type: boolean}}}',
    '---',
    `// ${note}`,
    'export default function (input: Input): Output {',
    '  if (input.fail === true) {',
    "    throw new Error('The tally does not add up');",
    '  }',
    '  return { counted: true };',
    '}',
  ].join('\n');

const approvalWorkflow = workflowSource(
  'approval',
  [
    'do:',
    '  - approve:',
    '      call: run_definition',
    '      with: { type: interaction, name: approve-brief, input: { owner: ada, campaign: Spring } }',
    '',
  ].join('\n'),
);

const interactionsOf = Schema.decodeUnknownSync(
  Schema.Struct({ interactions: Schema.Array(Schema.Struct({ run_id: Schema.String })) }),
);

export interface ActivityPlaybook {
  readonly playbook: string;
  readonly call: (method: string, path: string, body?: unknown) => ReturnType<ReasoningServer['call']>;
  readonly ran: (type: string, name: string, input: unknown) => Promise<string>;
  readonly refused: (type: string, name: string, input: unknown) => Promise<number>;
  readonly settled: (runId: string) => Promise<unknown>;
  readonly openRequests: (count: number) => Promise<readonly string[]>;
}

export function activityPlaybookOn(server: ReasoningServer, org: string, key?: string): ActivityPlaybook {
  const playbook = `/v1/orgs/${org}/playbooks/alpha`;
  const call = (method: string, path: string, body?: unknown) =>
    server.call(method, path, { ...(key === undefined ? {} : { key }), ...(body === undefined ? {} : { body }) });
  return {
    playbook,
    call,
    ran: async (type, name, input) =>
      runIdIn((await call('POST', `${playbook}/definitions/${type}/${name}/run`, { input })).body),
    refused: async (type, name, input) =>
      (await call('POST', `${playbook}/definitions/${type}/${name}/run`, { input })).status,
    settled: async (runId) =>
      (await settledRun(server, `${playbook}/runs/${runId}`, key === undefined ? {} : { key })).body,
    openRequests: async (count) => {
      const { interactions } = await until(
        async () => interactionsOf((await call('GET', `${playbook}/interactions`)).body),
        (listed) => listed.interactions.length === count,
      );
      return interactions.map(({ run_id: runId }) => runId);
    },
  };
}

export async function madePlaybook(server: ReasoningServer, org: string, key?: string): Promise<ActivityPlaybook> {
  const made = activityPlaybookOn(server, org, key);
  const { playbook, call } = made;
  await call('POST', `/v1/orgs/${org}/playbooks`, { playbook: 'alpha', name: 'Alpha' });
  await call('POST', `${playbook}/definitions/interaction`, {
    name: 'approve-brief',
    source: approvalDocument(agentDelivery),
    diagram: 'none',
  });
  await call('POST', `${playbook}/definitions/computation`, {
    name: 'tally',
    source: tallySource('first'),
    diagram: 'none',
  });
  await call('POST', `${playbook}/definitions/workflow`, { name: 'approval', source: approvalWorkflow });
  return made;
}
