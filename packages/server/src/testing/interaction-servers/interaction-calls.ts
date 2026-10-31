import type { McpSession, ToolResult } from '@on.auto/api/testing';

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
  await session.callTool('create_definition', inPlaybook({ ...asking, source: approvalRequest }));
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
