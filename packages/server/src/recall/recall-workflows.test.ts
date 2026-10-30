import { withMcpSession } from '@on.auto/api/testing';
import { answers, jsonResult, type ScriptedReply } from '@on.auto/reasoning/testing';
import { foldOf, recallDocument } from '@on.auto/recall/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import {
  playbookWithReviews,
  inState,
  liveWith,
  servingRecall,
  standingUntil,
  verdicts,
} from '../testing/servers/recall-server.ts';
import { runIdIn, settledRun, settledOverMcp, workflowSource } from '../testing/servers/workflow-server.ts';

const advise = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {reviews: {type: array}}, required: [reviews]}',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Given the verdicts this playbook reached on the campaign before, {{ input.reviews }}, should it approve the campaign?',
].join('\n');

const tally = [
  '---',
  'language: typescript',
  '---',
  'export default function (input: any): Output {',
  '  const counted = (verdict: string): number => input.reviews.filter((review: any) => review.verdict === verdict).length;',
  "  return { approvals: counted('approve'), rejections: counted('reject'), approve: input.advice.approve };",
  '}',
].join('\n');

const stalling = recallDocument(
  foldOf("throw new Error('cannot fold this');"),
  'language: typescript\nsource:\n  events:\n    - type: run_succeeded\n      subject: reasoning/review-brief',
);

function recallingWorkflow(name: string, recall: string): string {
  return workflowSource(
    name,
    `do:
  - recall:
      try:
        - remember:
            call: run_definition
            with: { type: recall, name: ${recall}, input: { campaign: '\${ $data.campaign }' } }
      catch:
        errors:
          with: { status: 503 }
        retry:
          delay: PT0.05S
          limit:
            attempt: { count: 3 }
      export:
        as: '\${ ({ reviews: $output }) }'
  - advise:
      call: run_definition
      with: { type: reasoning, name: advise, input: { reviews: '\${ $context.reviews }' } }
  - tally:
      call: run_definition
      with: { type: computation, name: tally, input: { reviews: '\${ $context.reviews }', advice: '\${ $data }' } }
`,
  );
}

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function serving(...more: readonly ScriptedReply[]): Promise<ReasoningServer> {
  const server = await servingRecall([
    ...verdicts({ campaign: 'spring', verdict: 'approve' }, { campaign: 'spring', verdict: 'reject' }),
    ...more,
  ]);
  closing.push(server.stop);
  await playbookWithReviews(server, 2);
  const definitions = [
    ['reasoning', 'advise', advise],
    ['computation', 'tally', tally],
    ['recall', 'stalling', stalling],
    ['workflow', 'decide', recallingWorkflow('decide', 'reviews')],
    ['workflow', 'stuck', recallingWorkflow('stuck', 'stalling')],
  ] as const;
  await definitions.reduce(
    (created: Promise<unknown>, [type, name, source]) =>
      created.then(() => server.call('POST', `${alpha}/definitions/${type}`, { body: { name, source } })),
    Promise.resolve(),
  );
  await standingUntil(server, 'reviews', liveWith(2));
  return server;
}

async function settledWorkflowRun(server: ReasoningServer, workflow: string) {
  const started = await server.call('POST', `${alpha}/definitions/workflow/${workflow}/run`, {
    body: { input: { campaign: 'spring' } },
  });
  return settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);
}

describe('a workflow that recalls, reasons and computes', () => {
  it('gives the reasoning function the verdicts the playbook reached before, and tallies them with its advice', async () => {
    const server = await serving(answers(jsonResult({ approve: false })));

    const settled = await settledWorkflowRun(server, 'decide');

    expect(settled).toMatchObject({
      body: { status: 'succeeded', output: { approvals: 1, rejections: 1, approve: false } },
    });
    expect(server.modelCalls()).toBe(3);
  });

  it('retries only what is unavailable, so a stalled recall function, a conflict, is run once and the workflow ends', async () => {
    const server = await serving();
    await standingUntil(server, 'stalling', inState('stalled'));

    const settled = await settledWorkflowRun(server, 'stuck');
    const recalls = await server.call('GET', `${alpha}/runs?type=recall`);

    expect(settled).toMatchObject({ body: { status: 'rejected' } });
    expect(recalls.body).toMatchObject({
      runs: [{ name: 'stalling', status: 'rejected', rejection: { reason: 'conflict', kind: 'stalled' } }],
    });
    expect(server.modelCalls()).toBe(2);
  });

  it('runs over MCP as it does over HTTP', async () => {
    const server = await serving(answers(jsonResult({ approve: true })));

    const settled = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
      async (session) => {
        const started = await session.callTool('run_definition', {
          type: 'workflow',
          name: 'decide',
          input: { campaign: 'spring' },
        });
        return settledOverMcp(session, String(started.structuredContent?.['run_id']));
      },
    );

    expect(settled.structuredContent).toMatchObject({
      status: 'succeeded',
      output: { approvals: 1, rejections: 1, approve: true },
    });
  });
});
