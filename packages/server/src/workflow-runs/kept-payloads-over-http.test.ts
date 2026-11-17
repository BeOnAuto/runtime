import { statementOf } from '@on.auto/ledger';
import { describe, expect, it, onTestFinished } from 'vitest';

import {
  answerDigest,
  answeredAndHeld,
  answeredOnce,
  eventSent,
  formatsOf,
  headsOfTheAnswer,
  notes,
  playbookOn,
  servedOn,
  started,
  succeededWithTheAnswer,
  waitingWithItsAnswerKept,
  type OpenStore,
} from '../testing/interaction-servers/kept-answer-servers.ts';
import {
  endedRunOf,
  postsDraftedOnThePage,
  reactingToTheReview,
} from '../testing/interaction-servers/kept-output-reactions.ts';
import { readOfTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

function onSQLite(): Promise<OpenStore> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return Promise.resolve({
    environment: {},
    served: { ledger },
    rows: (sql) => readOfTheLedgerIn(ledger.fileName, statementOf([sql], [])),
  });
}

describe('a workflow handed values its playbook keeps outside, over HTTP', () => {
  it('is handed the answer a person gave past the threshold, kept across a wait', async () => {
    const opened = await onSQLite();
    const { server, runId } = await waitingWithItsAnswerKept(opened);

    await eventSent(server, runId);

    expect(await server.settled(runId)).toMatchObject(succeededWithTheAnswer);
    expect(await headsOfTheAnswer(opened)).toBe(1);
  });

  it('is handed the kept output of a workflow it called, handed a kept answer', async () => {
    const server = await playbookOn(await onSQLite());
    const runId = await started(server, 'calling');

    await answeredOnce(server, 1);

    expect(await server.settled(runId)).toMatchObject({
      status: 'succeeded',
      output: { length: notes.length, choice: 'approve' },
    });
  });

  it('keeps the same answer once for two runs, each of whose logs holds it', async () => {
    const opened = await onSQLite();
    const server = await playbookOn(opened);
    const runs = [await started(server, 'waiting'), await started(server, 'waiting')];

    await answeredAndHeld(opened, server, 2);
    await Promise.all(runs.map((runId) => eventSent(server, runId)));

    expect(await Promise.all(runs.map((runId) => server.settled(runId)))).toMatchObject([
      succeededWithTheAnswer,
      succeededWithTheAnswer,
    ]);
    expect(await headsOfTheAnswer(opened)).toBe(1);
  });
});

describe('a run that keeps values outside, across a restart', () => {
  it('reads the kept answer back once the server that held it stopped', async () => {
    const opened = await onSQLite();
    const { server, runId } = await waitingWithItsAnswerKept(opened);
    await server.stop();

    const second = await servedOn(opened);
    await eventSent(second, runId);

    expect(await second.settled(runId)).toMatchObject(succeededWithTheAnswer);
  });

  it('goes on with payloads no longer kept outside, its log at format 12', async () => {
    const opened = await onSQLite();
    const { server, runId } = await waitingWithItsAnswerKept(opened);
    await server.stop();

    const switchedOff = await servedOn(opened, false);
    await eventSent(switchedOff, runId);

    expect(await switchedOff.settled(runId)).toMatchObject(succeededWithTheAnswer);
    expect(await formatsOf(opened, runId)).toEqual([12, 12, 12]);
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
    const { server, runId } = await waitingWithItsAnswerKept(opened);
    await server.stop();

    const second = await servedOn(opened);
    await opened.rows(`DELETE FROM recorded_content_heads WHERE sha256 = '${answerDigest}'`);
    await eventSent(second, runId);

    expect(await second.settled(runId)).toMatchObject({ status: 'rejected', rejection: { reason: 'unavailable' } });
  });

  it('does not start again once the kept answer is gone from its store, and says so', async () => {
    const opened = await onSQLite();
    const { server } = await waitingWithItsAnswerKept(opened);
    await server.stop();
    await opened.rows(`DELETE FROM recorded_content_heads WHERE sha256 = '${answerDigest}'`);

    await expect(servedOn(opened)).rejects.toThrow(
      /its records name content this server cannot find\. Content is kept in the ledger's database, since CONTENT_STORE_URL is not set, but 1 of the \d+ it looked for is not there/u,
    );
  });
});

describe('a trigger, a listener and a page given the output a run keeps outside', () => {
  it('starts the trigger’s workflow and wakes the listening run with the whole output', async () => {
    const opened = await onSQLite();
    const server = await playbookOn(opened);
    await reactingToTheReview(server);
    const listening = await started(server, 'listening');
    const waiting = await started(server, 'waiting');

    await answeredAndHeld(opened, server, 1);
    await eventSent(server, waiting);

    expect(await server.settled(await endedRunOf(server, 'on-review'))).toMatchObject({
      status: 'succeeded',
      output: { length: notes.length },
    });
    expect(await server.settled(listening)).toMatchObject({ status: 'succeeded', output: { length: notes.length } });
  });

  it('folds the whole output into a page’s view, as it does where the output is inline', async () => {
    expect([
      await postsDraftedOnThePage(await onSQLite(), true),
      await postsDraftedOnThePage(await onSQLite(), false),
    ]).toEqual(['Since it began, 3 posts were drafted.', 'Since it began, 3 posts were drafted.']);
  });
});
