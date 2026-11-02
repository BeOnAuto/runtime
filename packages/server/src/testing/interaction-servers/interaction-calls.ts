import type { McpSession, ToolResult } from '@on.auto/api/testing';
import { Schema } from 'effect';

import type { ReasoningServer } from '../servers/reasoning-server.ts';

const approvalRequest = [
  '---',
  "to: '{{ input.owner }}'",
  'expires: P1D',
  'deliver: agent',
  'output:',
  '  schema: { type: object, required: [choice], properties: { choice: { type: string } } }',
  '---',
  'Approve the quarter?',
].join('\n');

type InPlaybook = (input: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;

export async function interactionsCalled(
  session: McpSession,
  inPlaybook: InPlaybook,
): Promise<readonly (readonly [string, ToolResult])[]> {
  const asking = { type: 'interaction', name: 'approval' };
  await session.callTool('create_definition', inPlaybook({ ...asking, source: approvalRequest, diagram: 'none' }));
  const asked = await session.callTool('run_definition', inPlaybook({ ...asking, input: { owner: 'ada' } }));
  const runId = String(asked.structuredContent?.['run_id']);
  return [
    ['list_interactions', await session.callTool('list_interactions', inPlaybook({}))],
    [
      'answer_interaction',
      await session.callTool('answer_interaction', inPlaybook({ run_id: runId, answer: { choice: 'yes' } })),
    ],
  ];
}

const CommentMadeSchema = Schema.Struct({ id: Schema.String });

export async function commentsCalled(
  session: McpSession,
  server: Pick<ReasoningServer, 'call'>,
  inPlaybook: InPlaybook,
): Promise<readonly (readonly [string, ToolResult])[]> {
  const { playbook } = Schema.decodeUnknownSync(Schema.Struct({ playbook: Schema.String }))(inPlaybook({}));
  const made = await server.call('POST', `/v1/orgs/local/playbooks/${playbook}/comments`, {
    body: { address: `playbooks/${playbook}`, text: 'Name the quarter in the summary.' },
  });
  const { id } = Schema.decodeUnknownSync(CommentMadeSchema)(made.body);
  return [
    ['list_comments', await session.callTool('list_comments', inPlaybook({}))],
    ['resolve_comment', await session.callTool('resolve_comment', inPlaybook({ id, how: 'acted' }))],
  ];
}
