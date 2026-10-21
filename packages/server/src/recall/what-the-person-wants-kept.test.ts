import { withMcpSession, type McpSession } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sentenceNaming } from '../testing/interaction-servers/meetings-server.ts';
import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { liveOverMcp, servingRecall } from '../testing/servers/recall-server.ts';

let server: ReasoningServer;

beforeAll(async () => {
  server = await servingRecall([]);
});

afterAll(async () => {
  await server.stop();
});

function onMcp<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, use);
}

const PromptSchema = Schema.Struct({
  messages: Schema.Array(Schema.Struct({ content: Schema.Struct({ text: Schema.optionalKey(Schema.String) }) })),
});

const revenueOfEachMonth = [
  '---',
  'description: The revenue the person gave for each month, the latest they gave for a month',
  'language: typescript',
  'source:',
  '  events:',
  '    - type: revenue.reported',
  'view:',
  '  initial: {}',
  '  schema: {type: object, maxProperties: 120, additionalProperties: {type: number}}',
  'input:',
  '  schema: {type: object, properties: {month: {type: string}}, required: [month]}',
  '---',
  'export function fold(view: View, event: Event): View {',
  '  const data = event.data;',
  '  const fieldOf = (name: string): Json | undefined =>',
  "    typeof data === 'object' && data !== null && !Array.isArray(data) ? data[name] : undefined;",
  "  const month = fieldOf('month');",
  "  const revenue = fieldOf('revenue');",
  "  return typeof month === 'string' && typeof revenue === 'number' ? { ...view, [month]: revenue } : view;",
  '}',
  '',
  'export function answer(view: View, input: Input): Output {',
  '  return (Object.hasOwn(view, input.month) ? view[input.month] : undefined) ?? null;',
  '}',
].join('\n');

const monthlyRevenue = { playbook: 'figures', name: 'monthly-revenue' };

function revenueReported(month: string, revenue: number) {
  return {
    playbook: monthlyRevenue.playbook,
    event: { source: '/finance', type: 'revenue.reported', data: { month, revenue } },
  };
}

async function keptAndAskedOverMcp(session: McpSession) {
  await session.callTool('create_playbook', { playbook: monthlyRevenue.playbook, name: 'Figures' });
  await session.callTool('publish_event', revenueReported('2026-08', 98_000));
  await session.callTool('publish_event', revenueReported('2026-09', 120_000));
  await session.callTool('create_definition', { ...monthlyRevenue, type: 'recall', source: revenueOfEachMonth });
  await liveOverMcp(session, monthlyRevenue, 2);
  return session.callTool('run_definition', { ...monthlyRevenue, type: 'recall', input: { month: '2026-08' } });
}

describe('episode 11: asked to keep the revenue of each month, to ask later for any month', () => {
  it('finds in the instructions that what the person wants kept goes in a recall function and not its own notes, and a recipe that publishes the figures', async () => {
    const { instructions, prompt } = await onMcp(async (session) => ({
      instructions: String(session.instructions),
      prompt: Schema.decodeUnknownSync(PromptSchema)(
        await session.getPrompt('remember', { what: 'the revenue of each month' }),
      ),
    }));

    expect(sentenceNaming(instructions, 'wants kept')).toBe(
      'What the person wants kept goes in a recall function, for anyone or a workflow to ask later, not your notes.',
    );
    expect(String(prompt.messages[0]?.content.text)).toContain(
      "3. For what the person tells you, publish it to the playbook with publish_event once they agree, one event for each fact, such as each month's figure:",
    );
  });

  it('keeps the figures in the playbook, whose recall function answers the revenue of the month asked for', async () => {
    const recalled = await onMcp(keptAndAskedOverMcp);

    expect(recalled.structuredContent).toMatchObject({ status: 'succeeded', output: 98_000 });
  });
});
