import type { ApprovalPorts } from '@on.auto/reasoning';
import { answers, textResult, toolCallsResult } from '@on.auto/reasoning/testing';
import { approvalKey } from '@on.auto/tool-servers/policy';
import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { askedDigest, askingForApproval } from '@on.auto/tool-servers/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { runIdIn, settledRun } from '../testing/servers/workflow-server.ts';

const shopKey = 'shop-api-key-5e2a9c71';

const source = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [shop/pay]', '---', 'Pay for order A-17.'].join(
  '\n',
);

const signing: ApprovalPorts = {
  sign: ({ person, asked }) => Effect.succeed(`approval of ${person} for ${String(asked.request)} ${asked.digest}`),
};

const approval = { server: 'shop', tool: 'pay', action: 'Pay for order A-17', site: 'shop.example', kind: 'pay' };

const ActivitySchema = Schema.Struct({
  rows: Schema.Array(
    Schema.Struct({ kind: Schema.String, run_id: Schema.NullOr(Schema.String), approval: Schema.Unknown }),
  ),
});

const HistorySchema = Schema.Struct({
  events: Schema.Array(Schema.Struct({ type: Schema.String, data: Schema.Unknown })),
});

async function paying() {
  const shop = await serveFakeMcp({ bearer: shopKey, tools: [askingForApproval()] });
  onTestFinished(shop.close);
  const server = await servingReasoning(
    [answers(toolCallsResult([['shop__pay', { order: 'A-17' }]])), answers(textResult('Paid for order A-17.'))],
    {
      SHOP_KEY: shopKey,
      TOOL_SERVERS: JSON.stringify({
        shop: { url: shop.url, headers: { Authorization: 'Bearer ${SHOP_KEY}' }, org: 'acme' },
      }),
    },
    undefined,
    { approvals: signing },
  );
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'pay-supplier', source, diagram: 'none' },
  });
  return { shop, server };
}

describe('a reasoning run whose tool asks for a person’s approval, over HTTP, for the local developer', () => {
  it('waits for the developer, listed with the action, and once they approve sends the call once more with the approval', async () => {
    const { shop, server } = await paying();
    const started = await server.call('POST', `${alpha}/definitions/reasoning/pay-supplier/run`, {
      body: { input: {} },
    });
    const runId = runIdIn(started.body);

    const listed = await server.call('GET', `${alpha}/interactions`);
    const activity = Schema.decodeUnknownSync(ActivitySchema)(
      (await server.call('GET', '/v1/orgs/acme/activity?kind=needs_you')).body,
    );
    const answered = await server.call('POST', `${alpha}/runs/${runId}/answer`, {
      body: { answer: { approved: true } },
    });
    const settled = await settledRun(server, `${alpha}/runs/${runId}`);
    const { events } = Schema.decodeUnknownSync(HistorySchema)(
      (await server.call('GET', `${alpha}/runs/${runId}/history`)).body,
    );

    expect(started).toMatchObject({ status: 200, body: { status: 'started' } });
    expect(listed.body).toMatchObject({
      interactions: [{ run_id: runId, type: 'reasoning', function: 'pay-supplier', to: 'local', approval }],
    });
    expect(activity.rows).toEqual([{ kind: 'needs_you', run_id: runId, approval }]);
    expect(answered.status).toBe(200);
    expect(settled.body).toMatchObject({ status: 'succeeded', output: 'Paid for order A-17.' });
    expect(shop.received()).toHaveLength(2);
    expect(shop.received()[0]?.meta).not.toHaveProperty([approvalKey]);
    expect(shop.received()[1]?.meta).toHaveProperty([approvalKey], `approval of local for approval-1 ${askedDigest}`);
    expect(events.map(({ type }) => type)).toEqual(
      expect.arrayContaining(['interaction_requested', 'request_answered']),
    );
    expect(events.find(({ type }) => type === 'request_answered')?.data).toMatchObject({ answer: { approved: true } });
  });
});
