import { listedTools, toolNamesIn, withMcpSession, type McpSession, type ToolResult } from '@on.auto/api/testing';
import { answers, textResult } from '@on.auto/reasoning/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servingWorkflows, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const greeting = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Greet {{ input.name }}.'].join('\n');

const welcome = workflowSource(
  'welcome',
  `do:
  - greet:
      call: run_definition
      with: { type: reasoning, name: greeting, input: { name: '\${ $data.name }' } }
      output:
        as: '\${ ({ greeting: $data }) }'
  - await:
      listen:
        to:
          one:
            with: { type: com.acme.customer.replied }
      output:
        as: '\${ ({ ...$input, reply: $data[0] }) }'
`,
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function onMcp<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, use);
}

function settled(session: McpSession, runId: string): Promise<ToolResult> {
  return until(
    () => session.callTool('get_run', { playbook: 'sales', run_id: runId }),
    (reading) => reading.structuredContent?.['status'] !== 'started',
  );
}

async function welcomedAfterReply(session: McpSession): Promise<ToolResult> {
  await session.callTool('create_playbook', { playbook: 'sales', name: 'Sales' });
  await session.callTool('create_definition', {
    playbook: 'sales',
    type: 'reasoning',
    name: 'greeting',
    source: greeting,
  });
  await session.callTool('create_definition', {
    playbook: 'sales',
    type: 'workflow',
    name: 'welcome',
    source: welcome,
  });
  const started = await session.callTool('run_definition', {
    playbook: 'sales',
    type: 'workflow',
    name: 'welcome',
    input: { name: 'Ada' },
  });
  const runId = String(started.structuredContent?.['run_id']);
  await session.callTool('send_run_event', {
    playbook: 'sales',
    run_id: runId,
    event: { type: 'com.acme.customer.replied', data: 'Thank you!' },
  });
  return settled(session, runId);
}

describe('/mcp with workflows', () => {
  it('lists thirty-one tools, and the description of run_definition says how to see whether a workflow run ended', async () => {
    server = await servingWorkflows([]);

    const listing = await onMcp((session) => session.listTools());
    const tools = toolNamesIn(listing);

    expect(tools).toHaveLength(31);
    expect(tools.slice(-2)).toEqual(['send_run_event', 'get_guide']);
    expect(listedTools(listing).find(({ name }) => name === 'run_definition')?.description).toContain(
      'a run that finishes later answers started with a run_id unless it ends before its first wait, and get_run shows how it ended.',
    );
  });

  it('runs a workflow in a playbook it created and sends it the event it waits for, on one connection', async () => {
    server = await servingWorkflows([answers(textResult('Hello, Ada.'))]);

    const run = await onMcp(welcomedAfterReply);

    expect(run.structuredContent).toMatchObject({
      status: 'succeeded',
      output: { greeting: 'Hello, Ada.', reply: 'Thank you!' },
    });
  });
});
