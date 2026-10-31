import { answers, textResult } from '@on.auto/reasoning/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { chatEnvironment, chatServer } from '../testing/interaction-servers/chat-deliveries.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { blocksInOrderOf, fencedBlocksOf } from '../testing/servers/tutorial-calls.ts';
import { runIdIn, servingWorkflows, settledRun } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const [reviewAndApprove, reviewCampaignBrief, approveCampaignBrief] = blocksInOrderOf(
  'reference/workflow-format.md',
).map(({ body }) => body);

const decodeListed = Schema.decodeUnknownSync(
  Schema.Struct({ interactions: Schema.Array(Schema.Struct({ run_id: Schema.String })) }),
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

describe('the example of the workflow format, through the server', () => {
  it('saves the functions the page shows, reviews the brief, asks its owner in the chat, and ends with the review and the approval', async () => {
    const chat = await chatServer();
    server = await servingWorkflows(
      [answers(textResult('Revise: the audience lacks a job role.'))],
      chatEnvironment(chat.url),
    );
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/definitions/reasoning`, {
      body: { name: 'review-campaign-brief', source: reviewCampaignBrief },
    });
    await server.call('POST', `${alpha}/definitions/interaction`, {
      body: { name: 'approve-campaign-brief', source: approveCampaignBrief },
    });

    const created = await server.call('POST', `${alpha}/definitions/workflow`, {
      body: { name: 'review-and-approve', source: reviewAndApprove },
    });
    const started = await server.call('POST', `${alpha}/definitions/workflow/review-and-approve/run`, {
      body: { input: { brief: 'Spring sale for returning customers.', owner: 'ada@example.com' } },
    });
    const [request] = await until(
      async () => decodeListed((await server.call('GET', `${alpha}/interactions`)).body).interactions,
      (interactions) => interactions.length > 0,
    );
    const approval = { verdict: 'approve', note: 'Approved for the spring sale.' };
    await server.call('POST', `${alpha}/runs/${String(request?.run_id)}/answer`, { body: { answer: approval } });

    expect(approveCampaignBrief).toBe(fencedBlocksOf('reference/interaction-format.md').get('markdown'));
    expect(created.status).toBe(201);
    expect(await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`)).toMatchObject({
      body: { status: 'succeeded', output: { review: 'Revise: the audience lacks a job role.', approval } },
    });
  });
});
