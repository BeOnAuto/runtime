import { jsonResult, answers } from '@on.auto/reasoning/testing';
import { reviewBrief } from '@on.auto/recall/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import {
  liveWith,
  recalled,
  reviewed,
  servingRecall,
  standingUntil,
  verdicts,
} from '../testing/servers/recall-server.ts';
import { blocksInOrderOf } from '../testing/servers/tutorial-calls.ts';
import { runIdIn, settledRun } from '../testing/servers/workflow-server.ts';

const blocks = blocksInOrderOf('reference/recall-format.md').map(({ body }) => body);

const [campaignReviews, , input, output] = blocks;

const [advise, tally, decide] = blocks.slice(-3);

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

const decodeVerdicts = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ verdict: Schema.String })));

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function saved(type: string, name: string, source: string | undefined) {
  return server.call('POST', `${alpha}/definitions/${type}`, { body: { name, source } });
}

describe('the example of the recall function format, through the server', () => {
  it('folds the runs of review-brief, answers the verdicts the page shows, and runs the workflow of the page', async () => {
    server = await servingRecall([
      ...verdicts(
        { campaign: 'spring-sale', verdict: 'reject: the budget is not stated' },
        { campaign: 'spring-sale', verdict: 'approve' },
      ),
      answers(jsonResult({ approve: true })),
    ]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await saved('reasoning', 'review-brief', reviewBrief);
    await reviewed(server, 2);
    const created = [
      await saved('recall', 'campaign-reviews', campaignReviews),
      await saved('reasoning', 'advise-on-campaign', advise),
      await saved('computation', 'tally-verdicts', tally),
      await saved('workflow', 'decide-on-campaign', decide),
    ];
    await standingUntil(server, 'campaign-reviews', liveWith(2));

    const recalling = await recalled(server, 'campaign-reviews', decodeJson(input));
    const started = await server.call('POST', `${alpha}/definitions/workflow/decide-on-campaign/run`, {
      body: { input: { campaign: 'spring-sale' } },
    });

    expect(created.map(({ status }) => status)).toEqual([201, 201, 201, 201]);
    expect(recalling.body).toMatchObject({ status: 'succeeded', output: decodeVerdicts(decodeJson(output)) });
    expect(await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`)).toMatchObject({
      body: { status: 'succeeded', output: { approvals: 1, rejections: 1, approve: true } },
    });
  });
});
