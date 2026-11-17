import { withMcpSession } from '@on.auto/api/testing';
import { localDeveloper } from '@on.auto/identity/testing';
import { openRequests } from '@on.auto/interaction';
import { agentDelivery, notificationDocument } from '@on.auto/interaction/testing';
import { projectedTableOf } from '@on.auto/operations';
import { answers, textResult } from '@on.auto/reasoning/testing';
import { movedClock } from '@on.auto/workflow-host/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { chatEnvironment, chatServer } from '../testing/interaction-servers/chat-deliveries.ts';
import {
  asking,
  brief,
  guarded,
  interactionServerOn,
  servingInteractions,
} from '../testing/interaction-servers/interaction-server.ts';
import { everyRowSet, onTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { approvalRunOn, fencedBlocksOf, pageOf } from '../testing/servers/tutorial-calls.ts';
import { runIdIn, servingWorkflows, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const answerIdOf = Schema.decodeUnknownSync(Schema.Struct({ answer_id: Schema.String }));

const developer = { id: 'local', name: localDeveloper.name };

const reference = fencedBlocksOf('reference/interaction-format.md');

const decodeAnswer = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)));

function ledgerFile(): string {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return ledger.fileName;
}

async function expiredAgo(file: string, milliseconds: number): Promise<void> {
  const past = Date.now() - milliseconds;
  await onTheLedgerIn(file, (connection) =>
    connection.write(everyRowSet(projectedTableOf(openRequests), { expires_at: past, ending_due_at: past })),
  );
}

const unansweredAsExpired = { status: 'rejected', rejection: { reason: 'unanswered', kind: 'expired' } };

const decodeRuns = Schema.decodeUnknownSync(
  Schema.Struct({
    runs: Schema.Array(Schema.Struct({ run_id: Schema.String, status: Schema.String })),
  }),
);

const onAnApproval = workflowSource(
  'on-approval',
  `schedule:
  on: { one: { with: { type: run_succeeded, subject: interaction/approve-brief } } }
do:
  - noted: { set: { choice: '\${ $data[0].data.output.choice }', answered_by: '\${ $data[0].caller }' } }
`,
);

const stepTimeoutMs = 500;

const hurried = `do:
  - ask:
      call: run_definition
      with: { type: interaction, name: approve-brief, input: { campaign: Spring, owner: ada } }
      timeout: { after: { milliseconds: ${stepTimeoutMs} } }
`;

describe('an interaction function held for an agent, over HTTP', () => {
  it('holds its request for an agent and takes a checked answer as the output, once, which its history shows', async () => {
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
      { run_id: runId, answer: { choice: 'approve' }, claimed_for: 'the campaign team', answered_by: developer },
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

describe('an interaction function held for an agent that ends without an answer, over HTTP', () => {
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
});

describe('a notification for an agent, over HTTP', () => {
  it('is refused at save, since a notification goes through a connection', async () => {
    const server = await servingInteractions();
    const saved = await server.call('POST', `${alpha}/definitions/interaction`, {
      body: { name: 'brief-out', source: notificationDocument(agentDelivery), diagram: 'none' },
    });

    expect([saved.status, saved.body]).toMatchObject([
      422,
      {
        errors: [
          {
            pointer: '/source',
            detail:
              'Line 4, /deliver: A notification takes no answer, so no agent holds it: it goes through a connection, deliver naming the tool that sends it. No connection or tool server serves this playbook; one can be connected with search and add_connection.',
          },
        ],
      },
    ]);
    expect(saved.body).not.toHaveProperty('options');
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

describe('a workflow that asks an agent', () => {
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

describe('the example of the interaction function format', () => {
  it('asks in the chat in a workflow that takes the answer the page shows as its output', async () => {
    const server = await interactionServerOn(chatEnvironment((await chatServer()).url));
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/definitions/interaction`, {
      body: { name: 'approve-campaign-brief', source: reference.get('markdown'), diagram: 'none' },
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
  it('reviews, asks in the chat and ends with the answer, in the words the MCP reference quotes', async () => {
    const chat = await chatServer();
    const server = await servingWorkflows(
      [answers(textResult('Revise: the audience lacks a job role.'))],
      chatEnvironment(chat.url, { org: 'local' }),
    );
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

describe('requests past their expiry while the server was stopped', () => {
  it('end unanswered as expired from the read model alone, which a catch names and an uncaught call passes on', async () => {
    const file = ledgerFile();
    const first = await servingInteractions(agentDelivery, { LEDGER_FILE: file });
    const asked = await first.ask('approve-brief');
    const caught = await first.workflow('guarded', guarded('approve-brief', 'expired'));
    const uncaught = await first.workflow('approval', `do:\n${asking('approve-brief', 'approve')}`);
    await first.openRequests(3);
    await first.stop();
    await expiredAgo(file, 1000);

    const second = await interactionServerOn({ LEDGER_FILE: file });

    expect(await second.settled(asked)).toMatchObject(unansweredAsExpired);
    expect(await second.settled(caught)).toMatchObject({ status: 'succeeded', output: { caught: 'expired' } });
    expect(await second.settled(uncaught)).toMatchObject(unansweredAsExpired);
    expect(await second.openRequests(0)).toEqual([]);
    expect(
      await second.call('POST', `${alpha}/definitions/interaction/approve-brief/run`, {
        body: { input: brief, run_id: asked },
      }),
    ).toMatchObject({ status: 410, body: { type: 'https://on.auto/problems/unanswered', kind: 'expired' } });
  });
});

describe('another workflow, triggered by the answer to a request', () => {
  it('starts on the ending of the interaction function and reads the answer and who gave it', async () => {
    const server = await servingInteractions();
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'on-approval', source: onAnApproval } });
    const runId = await server.ask('approve-brief');

    await server.answer(runId, { answer: { choice: 'approve' } });
    const [reaction] = await until(
      async () => decodeRuns((await server.call('GET', `${alpha}/runs?type=workflow&name=on-approval`)).body).runs,
      (runs) => runs.some(({ status }) => status !== 'started'),
    );

    expect(await server.settled(String(reaction?.run_id))).toMatchObject({
      status: 'succeeded',
      output: { choice: 'approve', answered_by: 'local' },
    });
  });
});

describe('a request a workflow step waits for past its deadline', () => {
  it('is cancelled with the kind deadline, and leaves the open requests', async () => {
    const clock = movedClock(Date.now());
    const server = await servingInteractions(agentDelivery, {}, { clock });
    const workflowId = await server.workflow('hurried', hurried);

    const [request] = await server.openRequests(1);
    clock.moveTo(clock.now() + stepTimeoutMs);
    const workflow = await server.settled(workflowId);
    const asked = await server.settled(String(request));

    expect(workflow).toMatchObject({ status: 'rejected', rejection: { reason: 'unavailable' } });
    expect(asked).toMatchObject({ status: 'rejected', rejection: { reason: 'cancelled', kind: 'deadline' } });
    expect(await server.openRequests(0)).toEqual([]);
  });
});
