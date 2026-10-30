import { withMcpSession } from '@on.auto/api/testing';
import { answers, textResult } from '@on.auto/reasoning/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { interactionServerOn } from '../testing/interaction-servers/interaction-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { approvalRunOn, fencedBlocksOf, pageOf } from '../testing/servers/tutorial-calls.ts';
import { runIdIn, servingWorkflows } from '../testing/servers/workflow-server.ts';

const reference = fencedBlocksOf('reference/interaction-format.md');

const decodeAnswer = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)));

describe('the example of the interaction function format', () => {
  it('asks through the inbox in a workflow that takes the answer the page shows as its output', async () => {
    const server = await interactionServerOn({});
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/definitions/interaction`, {
      body: { name: 'approve-campaign-brief', source: reference.get('markdown') },
    });
    await server.call('POST', `${alpha}/definitions/workflow`, {
      body: { name: 'brief-approval', source: reference.get('yaml') },
    });
    const started = await server.call('POST', `${alpha}/definitions/workflow/brief-approval/run`, {
      body: { input: { owner: 'ada@example.com', review: 'Ready: all four criteria are met.' } },
    });
    const [request] = await server.openRequests(1);
    const answered = await server.answer(String(request), decodeAnswer(reference.get('json')));

    expect(answered.status).toBe(200);
    expect(await server.settled(runIdIn(started.body))).toMatchObject({
      status: 'succeeded',
      output: { verdict: 'approve', note: 'Ready to launch.' },
    });
  });
});

describe('the approval workflow in the MCP reference', () => {
  it('reviews, asks through the inbox and ends with the answer, in the words the MCP reference quotes', async () => {
    const server = await servingWorkflows([answers(textResult('Revise: the audience lacks a job role.'))]);
    onTestFinished(server.stop);
    const run = await withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, approvalRunOn);
    const quoted = pageOf('reference/mcp.md');

    expect(run.summaries.filter((summary) => !quoted.includes(summary))).toEqual([]);
    expect(run.output).toEqual({
      review: 'Revise: the audience lacks a job role.',
      approval: { verdict: 'approve', note: 'Approved for the autumn launch.' },
    });
    expect(run.answeredAgain).toBe(true);
  });
});
