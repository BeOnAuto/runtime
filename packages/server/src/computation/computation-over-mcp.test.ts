import { listedTools, plainTextIn, problemIn, textOf, withMcpSession, type McpSession } from '@on.auto/api/testing';
import { campaignPace, campaignRows } from '@on.auto/computation/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { servingReasoning } from '../testing/servers/reasoning-server.ts';

const dated = [
  '---',
  'language: typescript',
  '---',
  'export default function (input: any): any {',
  '  return { at: new Date(0), count: input.length };',
  '}',
].join('\n');

const total = [
  '---',
  'language: typescript',
  '---',
  'export default function (input: any): Output {',
  '  return { total_spend_cents: input.rows.reduce((sum: number, row: any) => sum + row.cost_cents, 0) };',
  '}',
].join('\n');

async function onAlpha<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  const server = await servingReasoning([]);
  onTestFinished(server.stop);
  await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' }),
  );
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    use,
  );
}

describe('a computation function over MCP, on the endpoint of its playbook', () => {
  it('is created, run and read back with its run and the words of its result', async () => {
    const { created, ran, run, summed } = await onAlpha(async (session) => {
      const creating = await session.callTool('create_definition', {
        type: 'computation',
        name: 'pace',
        source: campaignPace,
      });
      const running = await session.callTool('run_definition', {
        type: 'computation',
        name: 'pace',
        input: campaignRows(4),
      });
      const reading = await session.callTool('get_run', {
        run_id: String(running.structuredContent?.['run_id']),
      });
      await session.callTool('create_definition', { type: 'computation', name: 'total', source: total });
      const summing = await session.callTool('run_definition', {
        type: 'computation',
        name: 'total',
        input: campaignRows(4),
      });
      return { created: creating, ran: running, run: reading, summed: summing };
    });

    expect(created.structuredContent).toMatchObject({ type: 'computation', name: 'pace', version: 1 });
    expect(ran.structuredContent).toMatchObject({ status: 'succeeded', output: { total_spend_cents: 4222 } });
    expect(plainTextIn(ran)).toBe(
      'Ran the computation function “pace”. Its result is too long to repeat here; the whole of it is in the details below.',
    );
    expect(plainTextIn(summed)).toBe('Ran the computation function “total”. Its result: total spend cents: 4222.');
    expect(run.structuredContent).toMatchObject({ record: { language: 'typescript' } });
  });
});

describe('a computation function that cannot work as written, over MCP', () => {
  it('answers a program whose output is not JSON with isError, the conflict and its kind, in plain words', async () => {
    const ran = await onAlpha(async (session) => {
      await session.callTool('create_definition', { type: 'computation', name: 'dated', source: dated });
      return session.callTool('run_definition', { type: 'computation', name: 'dated', input: [1, 2] });
    });

    expect({ isError: ran.isError, problem: problemIn(ran) }).toMatchObject({
      isError: true,
      problem: {
        status: 409,
        reason: 'conflict',
        kind: 'unworkable',
        detail: "The program's output is not JSON: The answer holds a Date at $.at, which JSON cannot carry",
      },
    });
    expect(plainTextIn(ran)).toContain('it cannot work as it is written');
    expect(internalTermsIn(plainTextIn(ran))).toEqual([]);
  });
});

const listingTheComputationGuide: unknown = expect.arrayContaining(['computation-function']);

describe('the definition tools an agent sees', () => {
  it('name a computation function in create_definition and its guide in get_guide, which says the language it is written in', async () => {
    const tools = listedTools(await onAlpha((session) => session.listTools()));
    const createDefinition = tools.find(({ name }) => name === 'create_definition');
    const getGuide = tools.find(({ name }) => name === 'get_guide');
    const guide = await onAlpha((session) => session.callTool('get_guide', { guide: 'computation-function' }));

    expect(createDefinition?.description).toContain('computation, a computation function;');
    expect(getGuide?.inputSchema).toMatchObject({
      properties: { guide: { enum: listingTheComputationGuide } },
    });
    expect(textOf(guide)).toContain('TypeScript');
  });
});
