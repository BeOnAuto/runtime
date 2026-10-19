import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { asking, brief, servingInteractions } from '../testing/interaction-servers/interaction-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { runIdIn } from '../testing/servers/workflow-server.ts';

const answerIdOf = Schema.decodeUnknownSync(Schema.Struct({ answer_id: Schema.String }));

describe('an interaction function through the inbox, over HTTP', () => {
  it('leaves its request in the inbox and takes a checked answer as the output, once, which its history shows', async () => {
    const server = await servingInteractions();
    const started = await server.call('POST', `${alpha}/definitions/interaction/approve-brief/run`, {
      body: { input: brief },
    });
    const runId = runIdIn(started.body);

    const listed = await server.call('GET', `${alpha}/interactions?to=ada&function=approve-brief`);
    const invalid = await server.answer(runId, { answer: { choice: 'maybe' } });
    const answered = await server.answer(runId, { answer: { choice: 'approve' }, claimed_for: 'the campaign team' });
    const again = await server.answer(runId, { answer: { choice: 'approve' } });
    const another = await server.answer(runId, { answer: { choice: 'reject' } });
    const settled = await server.settled(runId);
    const answerEvent = await server.call('GET', `${alpha}/events/${answerIdOf(answered.body).answer_id}`);
    const history = await server.call('GET', `${alpha}/runs/${runId}/history`);
    const analytics = await server.call('GET', `${alpha}/analytics?type=interaction`);

    expect(started).toMatchObject({ status: 200, body: { status: 'started' } });
    expect(listed).toMatchObject({ status: 200, body: { interactions: [{ run_id: runId, type: 'interaction' }] } });
    expect([invalid.status, answered.status, again.status, another.status]).toEqual([422, 200, 200, 409]);
    expect([answered.body, again.body]).toMatchObject([
      { run_id: runId, answer: { choice: 'approve' }, claimed_for: 'the campaign team', answered_by: 'local' },
      { claimed_for: 'the campaign team' },
    ]);
    expect(invalid.body).toMatchObject({ errors: [{ pointer: '/answer/choice' }] });
    expect(answerEvent).toMatchObject({
      status: 200,
      body: {
        type: 'request_answered',
        summary: 'The request was answered, and the run takes the answer.',
        data: { answer: { choice: 'approve' }, claimed_for: 'the campaign team' },
      },
    });
    expect(settled).toMatchObject({ status: 'succeeded', output: { choice: 'approve' } });
    expect(history.body).toMatchObject({
      events: [
        { type: 'run_started' },
        { type: 'interaction_requested' },
        { type: 'request_answered', data: { answer: { choice: 'approve' }, claimed_for: 'the campaign team' } },
        { data: { output: { choice: 'approve' } } },
      ],
    });
    expect(analytics.body).toMatchObject({
      runs: { succeeded: 1 },
      by_function: [{ type: 'interaction', name: 'approve-brief', runs: 1 }],
    });
  });
});

describe('an interaction function through the inbox that ends without an answer, over HTTP', () => {
  it('ends a cancelled request as cancelled, which a late answer then finds ended', async () => {
    const server = await servingInteractions();
    const runId = await server.ask('approve-brief');

    await server.call('POST', `${alpha}/runs/${runId}/cancel`, { body: { reason: 'The brief was withdrawn' } });
    const settled = await server.settled(runId);
    const late = await server.answer(runId, { answer: { choice: 'approve' } });

    expect(settled).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'cancelled', detail: 'The brief was withdrawn' },
    });
    expect([late.status, await server.openRequests(0)]).toEqual([409, []]);
  });

  it('succeeds a notification at once, with nothing left in the inbox', async () => {
    const server = await servingInteractions();
    const runId = await server.ask('brief-out');

    expect(await server.settled(runId)).toMatchObject({ status: 'succeeded', output: {} });
    expect((await server.call('GET', `${alpha}/interactions`)).body).toMatchObject({ interactions: [] });
  });
});

describe('an Authorization header that holds no Bearer key, over HTTP', () => {
  it('is refused as malformed, in the one sentence that names Bearer, before any playbook is read', async () => {
    const server = await servingInteractions();
    const answered = await server.call('POST', `${alpha}/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/answer`, {
      body: { answer: { choice: 'approve' } },
      authorization: 'Request not-a-token-of-any-request',
    });

    expect([answered.status, answered.body]).toMatchObject([
      400,
      {
        reason: 'bad_request',
        detail: 'The Authorization header must hold exactly one API key or access token, as Bearer <key or token>',
      },
    ]);
  });
});

describe('a workflow that asks through the inbox', () => {
  it('waits for the answer and takes it as the output of its step', async () => {
    const server = await servingInteractions();
    const workflowId = await server.workflow('approval', `do:\n${asking('approve-brief', 'approve')}`);

    const [request] = await server.openRequests(1);
    await server.answer(String(request), { answer: { choice: 'approve', note: 'Ship it' } });

    expect(await server.settled(workflowId)).toMatchObject({
      status: 'succeeded',
      output: { choice: 'approve', note: 'Ship it' },
    });
  });
});
