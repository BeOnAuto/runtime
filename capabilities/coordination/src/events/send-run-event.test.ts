import { mostEventDataDepth, mostInputDepth } from '@on.auto/definitions';
import { mostValueDepth } from '@on.auto/workflow-engine';
import { HostElsewhere, HostStopped } from '@on.auto/workflow-host';
import { Effect, type Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testPlaybookNames } from '../testing/test-sandbox.ts';
import { workflowPlaybook, type WorkflowPlaybook } from '../testing/workflow-playbook.ts';
import { acmeCaller } from '../testing/workflows.ts';
import { defineSendRunEvent } from './send-run-event.ts';

let playbook: WorkflowPlaybook;

let sendEvent: ReturnType<typeof defineSendRunEvent>;

const approval = `document:
  dsl: '1.0.3'
  namespace: acme
  name: approval
  version: '1.0.0'
do:
  - await:
      listen:
        to:
          one:
            with: { type: com.acme.approval.decided }
`;

const envelope = approval.replace('name: approval', 'name: envelope').concat('        read: envelope\n');

function nested(levels: number): Schema.Json {
  return levels === 0 ? 'yes' : [nested(levels - 1)];
}

beforeAll(async () => {
  playbook = await workflowPlaybook();
  sendEvent = defineSendRunEvent(playbook.host, testPlaybookNames);
  await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'approval', source: approval });
  await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'envelope', source: envelope });
  await playbook.call(playbook.createDefinition, { type: 'echo', name: 'greet', source: '{"greeting": "Hello"}' });
});

afterAll(async () => {
  await playbook.close();
});

const tooLong: readonly (readonly [string, Readonly<Record<string, string>>, string])[] = [
  ['a type', { type: 't'.repeat(257) }, '/event/type'],
  ['an id', { type: 'x', id: 'i'.repeat(257) }, '/event/id'],
  ['a source', { type: 'x', source: 's'.repeat(1025) }, '/event/source'],
  ['a subject', { type: 'x', subject: 's'.repeat(1025) }, '/event/subject'],
];

function idOf(number: number): string {
  return `0199a3c4-7d2e-7c1a-9b3f-${String(number).padStart(12, '4')}`;
}

async function startedApproval(runId: string): Promise<void> {
  await playbook.call(playbook.runDefinition, { type: 'workflow', name: 'approval', run_id: runId });
}

describe('send_run_event', () => {
  it('is a playbook command at POST /runs/{run_id}/events', () => {
    expect(sendEvent.registration).toMatchObject({
      scope: 'playbook',
      kind: 'command',
      route: { method: 'POST', path: '/runs/{run_id}/events' },
      reasons: ['not_found', 'unavailable'],
    });
  });

  it('delivers an event to the running workflow, which listens for it and ends', async () => {
    const runId = idOf(1);
    await startedApproval(runId);

    const sent = await playbook.call(sendEvent, {
      run_id: runId.toUpperCase(),
      event: { id: 'decision-1', type: 'com.acme.approval.decided', data: { approved: true } },
    });

    expect(sent).toMatchObject({
      status: 'succeeded',
      output: { run_id: runId, event: { id: 'decision-1', type: 'com.acme.approval.decided' } },
    });
    expect(await playbook.settled(runId)).toMatchObject({
      output: { status: 'succeeded', output: [{ approved: true }] },
    });
  });

  it('gives an event an id, the caller who sent it as its source, and the time it was sent', async () => {
    const runId = idOf(2);
    await startedApproval(runId);

    const sent = await playbook.call(sendEvent, { run_id: runId, event: { type: 'com.acme.other' } });

    expect(sent).toMatchObject({
      status: 'succeeded',
      output: { event: { type: 'com.acme.other', source: `/callers/${acmeCaller.id}` } },
    });
    expect(JSON.stringify(sent)).toMatch(/"id":"[0-9a-f-]{36}","time":"\d{4}-\d{2}-\d{2}T/u);
  });
});

describe('send_run_event to no running workflow', () => {
  it('is rejected as not found for an unknown run or one of another type', async () => {
    const greeted = idOf(3);
    await playbook.call(playbook.runDefinition, { type: 'echo', name: 'greet', run_id: greeted });
    const notFound = { status: 'rejected', reason: 'not_found' };

    expect(await playbook.call(sendEvent, { run_id: idOf(4), event: { type: 'x' } })).toMatchObject(notFound);
    expect(await playbook.call(sendEvent, { run_id: greeted, event: { type: 'x' } })).toMatchObject({
      ...notFound,
      detail: 'The playbook has no active workflow run with that id',
    });
  });

  it.each(['not_started', 'ended'] as const)(
    'is rejected as not found when the run on the host answers %s',
    async (answer) => {
      const runId = idOf(5);
      const answering = defineSendRunEvent({ deliver: () => Effect.succeed(answer) }, testPlaybookNames);
      await startedApproval(runId);

      expect(await playbook.call(answering, { run_id: runId, event: { type: 'x' } })).toEqual({
        status: 'rejected',
        reason: 'not_found',
        detail: 'The playbook has no active workflow run with that id',
      });
    },
  );
});

describe('send_run_event that cannot be delivered', () => {
  it('is rejected as unavailable when the workflow cannot take it at that moment', async () => {
    const runId = idOf(6);
    await startedApproval(runId);
    const stopping = defineSendRunEvent(
      { deliver: () => Effect.fail(new HostStopped({ detail: 'The server is stopping' })) },
      testPlaybookNames,
    );

    expect(await playbook.call(stopping, { run_id: runId, event: { type: 'x' } })).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'The workflow cannot take the event now; try again shortly',
    });
  });

  it('is rejected as unavailable, saying so, when another server runs the workflows of the database', async () => {
    const runId = idOf(19);
    await startedApproval(runId);
    const detail = 'The workflows of this database run in another server';
    const elsewhere = defineSendRunEvent(
      { deliver: () => Effect.fail(new HostElsewhere({ detail })) },
      testPlaybookNames,
    );

    expect(await playbook.call(elsewhere, { run_id: runId, event: { type: 'x' } })).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail,
    });
  });

  it('is rejected as invalid input when its data is larger than an event carries', async () => {
    expect(
      await playbook.call(sendEvent, { run_id: idOf(7), event: { type: 'x', data: 'x'.repeat(262_200) } }),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
  });
});

describe('an event that does not fit', () => {
  it.each(tooLong)(
    'is rejected as invalid input when %s is longer than an event carries',
    async (_, event, pointer) => {
      expect(await playbook.call(sendEvent, { run_id: idOf(8), event })).toMatchObject({
        status: 'rejected',
        reason: 'invalid_input',
        issues: [expect.objectContaining({ pointer })],
      });
    },
  );

  it('is rejected as invalid input when the whole event takes more than 262144 bytes, each field within its bound', async () => {
    const event = {
      type: 't'.repeat(256),
      source: 's'.repeat(1024),
      subject: 's'.repeat(1024),
      data: 'd'.repeat(260_000),
    };

    expect(await playbook.call(sendEvent, { run_id: idOf(9), event })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [expect.objectContaining({ pointer: '/event' })],
    });
  });
});

describe('an event that poses as what the playbook records itself', () => {
  it('is rejected as invalid input, as one published to the playbook, and leaves the run waiting', async () => {
    const runId = idOf(22);
    await startedApproval(runId);

    const forged = await playbook.call(sendEvent, {
      run_id: runId,
      event: { type: 'run_succeeded', source: `/runs/${runId}`, data: { approved: true } },
    });

    expect(forged).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/event/type' }, { pointer: '/event/source' }],
    });
    expect(await playbook.call(playbook.getRun, { run_id: runId })).toMatchObject({
      output: { status: 'started' },
    });
  });

  it('is rejected when it claims the lineage the playbook gives its own records', async () => {
    const runId = idOf(23);
    await startedApproval(runId);

    const forged = await playbook.call(sendEvent, {
      run_id: runId,
      event: { type: 'com.acme.approved', causationid: 'request-1', correlationid: runId },
    });

    expect(forged).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/event/causationid' }, { pointer: '/event/correlationid' }],
    });
  });
});

describe('the data of an event', () => {
  it('may nest as deep as a workflow holds the whole event in a list, which it takes', async () => {
    const runId = idOf(20);
    await playbook.call(playbook.runDefinition, { type: 'workflow', name: 'envelope', run_id: runId });

    const sent = await playbook.call(sendEvent, {
      run_id: runId,
      event: { type: 'com.acme.approval.decided', data: nested(510) },
    });

    expect(sent).toMatchObject({ status: 'succeeded' });
    expect(await playbook.settled(runId)).toMatchObject({ output: { status: 'succeeded' } });
  });

  it('is rejected as invalid input deeper than that, as the data of an event published to the playbook', async () => {
    expect(await playbook.call(sendEvent, { run_id: idOf(21), event: { type: 'x', data: nested(511) } })).toMatchObject(
      {
        status: 'rejected',
        reason: 'invalid_input',
        issues: [
          {
            detail:
              'Expected data that nests at most 510 levels deep, so that the workflow can hold the event in a list',
            pointer: '/event/data',
          },
        ],
      },
    );
    expect([mostInputDepth, mostEventDataDepth]).toEqual([mostValueDepth, mostValueDepth - 2]);
  });
});

describe('the plain language of send_run_event', () => {
  const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

  it('says which event reached the running workflow', () => {
    const delivered = {
      type: 'com.acme.approval.decided',
      id: 'e-1',
      source: '/callers/acme-admin',
      time: '2026-10-02T09:00:00.000Z',
    };

    expect(
      sendEvent.registration.plainLanguage?.outcome(
        { run_id: runId, event: delivered },
        { run_id: runId, event: { type: delivered.type } },
      ),
    ).toBe(
      'Delivered the event “com.acme.approval.decided” to the running workflow. The workflow uses it as soon as it is waiting for it.',
    );
  });

  it('names the event it tried to send, or what it tried', () => {
    expect([
      sendEvent.registration.plainLanguage?.attempt({ run_id: runId, event: { type: 'com.acme.ping' } }),
      sendEvent.registration.plainLanguage?.attempt({}),
    ]).toEqual(['send the event “com.acme.ping” to a running workflow', 'send an event to a running workflow']);
  });
});
