import { listedTools, plainTextIn, textOf, withMcpSession, type McpSession } from '@on.auto/api/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { campaignReviews, foldOf, recallDocument } from '@on.auto/recall/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { anyReview, liveOverMcp, servingRecall, verdicts } from '../testing/servers/recall-server.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function onAlpha<T>(server: ReasoningServer, use: (session: McpSession) => Promise<T>): Promise<T> {
  await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' }),
  );
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    use,
  );
}

const counting = recallDocument(
  foldOf('return view + 1;'),
  'language: typescript\nsource:\n  events:\n    - type: run_succeeded\nview:\n  initial: 0',
);

describe('a recall function over MCP, on the endpoint of its playbook', () => {
  it('is saved, stands live once it has folded the runs it names, and answers from its view in plain words', async () => {
    const server = await servingRecall(verdicts({ campaign: 'spring', verdict: 'approve' }));
    closing.push(server.stop);

    const { created, definition, recalled, run, count } = await onAlpha(server, async (session) => {
      await session.callTool('create_definition', { type: 'reasoning', name: 'review-brief', source: anyReview });
      const creating = await session.callTool('create_definition', {
        type: 'recall',
        name: 'reviews',
        source: campaignReviews,
      });
      await session.callTool('create_definition', { type: 'recall', name: 'count', source: counting });
      await session.callTool('run_definition', {
        type: 'reasoning',
        name: 'review-brief',
        input: { brief: 'spring' },
      });
      const live = await liveOverMcp(session, { name: 'reviews' }, 1);
      await liveOverMcp(session, { name: 'count' }, 1);
      const counted = await session.callTool('run_definition', { type: 'recall', name: 'count', input: {} });
      const recalling = await session.callTool('run_definition', {
        type: 'recall',
        name: 'reviews',
        input: { campaign: 'spring' },
      });
      const reading = await session.callTool('get_run', {
        run_id: String(recalling.structuredContent?.['run_id']),
      });
      return { created: creating, definition: live, recalled: recalling, run: reading, count: counted };
    });

    expect(created.structuredContent).toMatchObject({ type: 'recall', name: 'reviews', version: 1 });
    expect(definition).toMatchObject({ standing: { state: 'live', version: 1, folded: 1 } });
    expect(recalled.structuredContent).toMatchObject({ status: 'succeeded', output: [{ verdict: 'approve' }] });
    expect(plainTextIn(recalled)).toMatch(/^Ran the recall function “reviews”\. Its result: /u);
    expect(plainTextIn(count)).toBe('Ran the recall function “count”. Its result: 1.');
    expect(internalTermsIn(plainTextIn(count))).toEqual([]);
    expect(run.structuredContent).toMatchObject({
      record: { language: 'typescript', view: { version: 1, folded: 1 } },
    });
  });
});

const listingTheRecallGuide: unknown = expect.arrayContaining(['recall-function']);

describe('the definition tools an agent sees', () => {
  it('name a recall function in create_definition and its guide in get_guide, which serves it whole', async () => {
    const server = await servingRecall([]);
    closing.push(server.stop);

    const tools = listedTools(await onAlpha(server, (session) => session.listTools()));
    const createDefinition = tools.find(({ name }) => name === 'create_definition');
    const getGuide = tools.find(({ name }) => name === 'get_guide');
    const everyTool = await withMcpSession(
      'current revision',
      { url: `${server.origin}/mcp`, headers: {} },
      (session) => session.listTools(),
    );

    const guide = await onAlpha(server, (session) => session.callTool('get_guide', { guide: 'recall-function' }));

    expect(listedTools(everyTool)).toHaveLength(30);
    expect(createDefinition?.description).toContain('recall, a recall function;');
    expect(getGuide?.inputSchema).toMatchObject({
      properties: { guide: { enum: listingTheRecallGuide } },
    });
    expect(textOf(guide)).toContain('# Recall function format');
  });
});
