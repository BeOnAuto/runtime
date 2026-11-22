import { statementOf } from '@on.auto/ledger';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import {
  answerDigest,
  answeredAndHeld,
  answeredOnce,
  eventSent,
  formatsOf,
  headsOfTheAnswer,
  notes,
  type OpenStore,
  playbookOn,
  servedOn,
  started,
  succeededWithTheAnswer,
  waitingWithItsAnswerKept,
} from '../testing/interaction-servers/kept-answer-servers.ts';
import {
  endedRunOf,
  postsDraftedOnThePage,
  reactingToTheReview,
} from '../testing/interaction-servers/kept-output-reactions.ts';
import { readOfTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

function onSQLite(): Promise<OpenStore> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return Promise.resolve({
    environment: {},
    served: { ledger },
    rows: (sql) => readOfTheLedgerIn(ledger.fileName, statementOf([sql], [])),
  });
}

const waiting = workflowSource(
  'waiting',
  `do:
  - decide:
      listen:
        to:
          one:
            with: { type: com.acme.approval.decided }
        read: envelope
`,
);

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function nested(levels: number): unknown {
  return levels === 0 ? 'yes' : [nested(levels - 1)];
}

let server: ReasoningServer;

async function playbookWithAWaitingWorkflow(): Promise<void> {
  server = await servingReasoning([]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'waiting', source: waiting } });
}

describe('a workflow handed values its playbook keeps outside, over HTTP', () => {
  it('is handed the answer a person gave past the threshold, kept across a wait', async () => {
    const opened = await onSQLite();
    const { server: serverKeptPayloads, runId: runIdKeptPayloads } = await waitingWithItsAnswerKept(opened);

    await eventSent(serverKeptPayloads, runIdKeptPayloads);

    expect(await serverKeptPayloads.settled(runIdKeptPayloads)).toMatchObject(succeededWithTheAnswer);
    expect(await headsOfTheAnswer(opened)).toBe(1);
  });

  it('is handed the kept output of a workflow it called, handed a kept answer', async () => {
    const serverKeptPayloads = await playbookOn(await onSQLite());
    const runIdKeptPayloads = await started(serverKeptPayloads, 'calling');

    await answeredOnce(serverKeptPayloads, 1);

    expect(await serverKeptPayloads.settled(runIdKeptPayloads)).toMatchObject({
      status: 'succeeded',
      output: { length: notes.length, choice: 'approve' },
    });
  });

  it('keeps the same answer once for two runs, each of whose logs holds it', async () => {
    const opened = await onSQLite();
    const serverKeptPayloads = await playbookOn(opened);
    const runs = [await started(serverKeptPayloads, 'waiting'), await started(serverKeptPayloads, 'waiting')];

    await answeredAndHeld(opened, serverKeptPayloads, 2);
    await Promise.all(runs.map((runIdKeptPayloads) => eventSent(serverKeptPayloads, runIdKeptPayloads)));

    expect(
      await Promise.all(runs.map((runIdKeptPayloads) => serverKeptPayloads.settled(runIdKeptPayloads))),
    ).toMatchObject([succeededWithTheAnswer, succeededWithTheAnswer]);
    expect(await headsOfTheAnswer(opened)).toBe(1);
  });
});

describe('a run that keeps values outside, across a restart', () => {
  it('reads the kept answer back once the server that held it stopped', async () => {
    const opened = await onSQLite();
    const { server: serverKeptPayloads, runId: runIdKeptPayloads } = await waitingWithItsAnswerKept(opened);
    await serverKeptPayloads.stop();

    const second = await servedOn(opened);
    await eventSent(second, runIdKeptPayloads);

    expect(await second.settled(runIdKeptPayloads)).toMatchObject(succeededWithTheAnswer);
  });

  it('goes on with payloads no longer kept outside, its log at format 12', async () => {
    const opened = await onSQLite();
    const { server: serverKeptPayloads, runId: runIdKeptPayloads } = await waitingWithItsAnswerKept(opened);
    await serverKeptPayloads.stop();

    const switchedOff = await servedOn(opened, false);
    await eventSent(switchedOff, runIdKeptPayloads);

    expect(await switchedOff.settled(runIdKeptPayloads)).toMatchObject(succeededWithTheAnswer);
    expect(await formatsOf(opened, runIdKeptPayloads)).toEqual([12, 12, 12]);
  });
});

describe('a run of a playbook that turned keeping on, or lost a kept value', () => {
  it('finishes a run begun at format 11, and starts a new one at 12', async () => {
    const opened = await onSQLite();
    const first = await playbookOn(opened, false);
    const earlier = await started(first, 'waiting');
    await answeredOnce(first, 1);
    await first.stop();

    const keeping = await servedOn(opened);
    await eventSent(keeping, earlier);
    const later = await started(keeping, 'waiting');
    await answeredAndHeld(opened, keeping, 1);
    await eventSent(keeping, later);

    expect([await keeping.settled(earlier), await keeping.settled(later)]).toMatchObject([
      succeededWithTheAnswer,
      succeededWithTheAnswer,
    ]);
    expect([(await formatsOf(opened, earlier))[0], (await formatsOf(opened, later))[0]]).toEqual([11, 12]);
  });

  it('ends rejected when the kept answer is gone from the store', async () => {
    const opened = await onSQLite();
    const { server: serverKeptPayloads, runId: runIdKeptPayloads } = await waitingWithItsAnswerKept(opened);
    await serverKeptPayloads.stop();

    const second = await servedOn(opened);
    await opened.rows(`DELETE FROM recorded_content_heads WHERE sha256 = '${answerDigest}'`);
    await eventSent(second, runIdKeptPayloads);

    expect(await second.settled(runIdKeptPayloads)).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'unavailable' },
    });
  });

  it('does not start again once the kept answer is gone from its store, and says so', async () => {
    const opened = await onSQLite();
    const { server: serverKeptPayloads } = await waitingWithItsAnswerKept(opened);
    await serverKeptPayloads.stop();
    await opened.rows(`DELETE FROM recorded_content_heads WHERE sha256 = '${answerDigest}'`);

    await expect(servedOn(opened)).rejects.toThrow(
      /its records name content this server cannot find\. Content is kept in the ledger's database, since CONTENT_STORE_URL is not set, but 1 of the \d+ it looked for is not there/u,
    );
  });
});

describe('a trigger, a listener and a page given the output a run keeps outside', () => {
  it('starts the trigger’s workflow and wakes the listening run with the whole output', async () => {
    const opened = await onSQLite();
    const serverKeptPayloads = await playbookOn(opened);
    await reactingToTheReview(serverKeptPayloads);
    const listening = await started(serverKeptPayloads, 'listening');
    const waitingKeptPayloads = await started(serverKeptPayloads, 'waiting');

    await answeredAndHeld(opened, serverKeptPayloads, 1);
    await eventSent(serverKeptPayloads, waitingKeptPayloads);

    expect(await serverKeptPayloads.settled(await endedRunOf(serverKeptPayloads, 'on-review'))).toMatchObject({
      status: 'succeeded',
      output: { length: notes.length },
    });
    expect(await serverKeptPayloads.settled(listening)).toMatchObject({
      status: 'succeeded',
      output: { length: notes.length },
    });
  });

  it('folds the whole output into a page’s view, as it does where the output is inline', async () => {
    expect([
      await postsDraftedOnThePage(await onSQLite(), true),
      await postsDraftedOnThePage(await onSQLite(), false),
    ]).toEqual(['Since it began, 3 posts were drafted.', 'Since it began, 3 posts were drafted.']);
  });
});

describe('nested values over http', () => {
  beforeAll(async () => {
    await playbookWithAWaitingWorkflow();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('values nested as deep as a run holds them, over HTTP', () => {
    it('are taken as a run input, as the data of a sent event and of a published one', async () => {
      const startedNestedValues = await server.call('POST', `${alpha}/definitions/workflow/waiting/run`, {
        body: { input: nested(512), run_id: runId },
      });
      const sent = await server.call('POST', `${alpha}/runs/${runId}/events`, {
        body: { event: { type: 'com.acme.approval.decided', data: nested(510) } },
      });
      const published = await server.call('POST', `${alpha}/events`, {
        body: { event: { source: '/ledger/eu', type: 'com.acme.ledger.month-closed', data: nested(510) } },
      });

      expect([startedNestedValues.status, sent.status, published.status]).toEqual([200, 200, 200]);
      expect(await settledRun(server, `${alpha}/runs/${runId}`)).toMatchObject({
        body: { status: 'succeeded' },
      });
    });

    it('are refused deeper than that, as invalid input, before anything is recorded', async () => {
      const runsBefore = await server.call('GET', `${alpha}/runs`);
      const ran = await server.call('POST', `${alpha}/definitions/workflow/waiting/run`, {
        body: { input: nested(3000) },
      });
      const sent = await server.call('POST', `${alpha}/runs/${runId}/events`, {
        body: { event: { type: 'com.acme.approval.decided', data: nested(3000) } },
      });
      const published = await server.call('POST', `${alpha}/events`, {
        body: { event: { source: '/ledger/eu', type: 'com.acme.ledger.month-closed', data: nested(3000) } },
      });

      expect([ran, sent, published].map(({ status, body }) => [status, body])).toMatchObject([
        [422, { reason: 'invalid_input', errors: [{ pointer: '/input' }] }],
        [422, { reason: 'invalid_input', errors: [{ pointer: '/event/data' }] }],
        [422, { reason: 'invalid_input', errors: [{ pointer: '/event/data' }] }],
      ]);
      expect((await server.call('GET', `${alpha}/runs`)).body).toEqual(runsBefore.body);
    });
  });
});
