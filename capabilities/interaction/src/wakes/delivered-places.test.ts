import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import { askedRun, deliveringTo, throughTheProvider } from '../testing/delivered-conversations.ts';
import { chatDelivery, notificationDocument } from '../testing/documents.ts';
import { answererId, recordsOf } from '../testing/index.ts';
import { everythingRecorded, theChannel } from '../testing/woken-conversations.ts';

const recorded = 'Auto recorded your answer: approve.';

const anotherRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7e';

describe('a delivered reply that names no request of this playbook waiting through this connection', () => {
  it('is passed over and writes nothing: a message the playbook never sent, another connection, another conversation, another org', async () => {
    const delivering = await deliveringTo();
    const approve = delivering.written('approve');
    const before = await everythingRecorded(delivering.playbook.ledger);

    const performed = [
      ...(await delivering.delivered([{ ...approve, to: '1699.999999' }])),
      ...(await delivering.delivered([approve], Date.now(), { connection: 'mail' })),
      ...(await delivering.delivered([approve], Date.now(), { conversation: '#approvals-marketing' })),
      ...(await delivering.delivered([approve], Date.now(), { playbook: { org: 'umbrella', playbook: 'alpha' } })),
    ];

    expect(performed.map(({ outcome }) => outcome)).toEqual([
      'passed_over',
      'passed_over',
      'passed_over',
      'passed_over',
    ]);
    expect(await everythingRecorded(delivering.playbook.ledger)).toEqual(before);
    expect(delivering.lines()).toEqual([]);
  });

  it('is passed over where its id or its writer is no part a reply may hold, as a read passes it over', async () => {
    const delivering = await deliveringTo();
    const approve = delivering.written('approve');

    const performed = await delivering.delivered([
      { ...approve, sender: '' },
      { ...approve, id: 'x'.repeat(4096) },
    ]);

    expect(performed.map(({ outcome }) => outcome)).toEqual(['passed_over', 'passed_over']);
    expect(await recordsOf(delivering.playbook.ledger, 'request_answered', 'reply_refused')).toEqual([]);
  });
});

describe('a delivered reply that names a message of this playbook no request waits on', () => {
  it('is passed over where it names the message of a request that reads no replies', async () => {
    const delivering = await deliveringTo();
    await delivering.playbook.define('announce-brief', notificationDocument(chatDelivery));
    await delivering.playbook.ask('announce-brief', { owner: 'sales', campaign: 'Spring' }, anotherRun);
    await delivering.playbook.performDue(Date.now());

    const performed = await delivering.delivered([delivering.written('approve', answererId, delivering.lastPosted())]);

    expect(performed).toMatchObject([{ outcome: 'passed_over' }]);
    expect(await recordsOf(delivering.playbook.ledger, 'request_answered', 'reply_refused')).toEqual([]);
  });

  it('is passed over where it names a message the playbook posted itself, whoever the chat names as its writer', async () => {
    const delivering = await deliveringTo({ ...throughTheProvider, postsAs: answererId });
    const { thread } = delivering;

    const performed = await delivering.delivered([
      { id: thread, sender: answererId, text: 'approve', to: thread, time: Date.now() },
    ]);

    expect(performed).toMatchObject([{ outcome: 'passed_over' }]);
    expect(await recordsOf(delivering.playbook.ledger, 'request_answered', 'reply_refused')).toEqual([]);
  });
});

describe('a delivered reply to a request that is no longer waiting', () => {
  it('is passed over where the run is being cancelled, and told nothing', async () => {
    const delivering = await deliveringTo();
    await delivering.playbook.cancel(askedRun);

    const performed = await delivering.delivered([delivering.written('approve')]);

    expect(performed).toMatchObject([{ outcome: 'passed_over' }]);
    expect(await recordsOf(delivering.playbook.ledger, 'request_answered', 'reply_refused')).toEqual([]);
    expect(delivering.lines()).toEqual([]);
  });

  it('is passed over where the request was answered in Auto, and not told it was already answered', async () => {
    const delivering = await deliveringTo();
    await delivering.playbook.call(answerInteraction, { run_id: askedRun, answer: { choice: 'reject' } });

    const performed = await delivering.delivered([delivering.written('approve')]);

    expect(performed).toMatchObject([{ outcome: 'passed_over' }]);
    expect(await recordsOf(delivering.playbook.ledger, 'request_answered')).toMatchObject([
      { data: { answer: { choice: 'reject' } } },
    ]);
    expect(delivering.lines()).toEqual([]);
  });
});

describe('delivered replies to two requests waiting in one conversation', () => {
  it('each go to the request whose message they name', async () => {
    const delivering = await deliveringTo();
    await delivering.playbook.askInThread(anotherRun);
    await delivering.playbook.performDue(Date.now());
    const other = delivering.lastPosted();
    const approve = delivering.written('approve');
    const reject = delivering.written('reject, not this quarter', answererId, other);

    const performed = await delivering.delivered([approve, reject]);

    expect(performed.map(({ outcome }) => outcome)).toEqual(['taken', 'taken']);
    expect(await recordsOf(delivering.playbook.ledger, 'request_answered')).toMatchObject([
      { data: { answer: { choice: 'approve' }, reply: { to: delivering.thread } }, context: { runId: askedRun } },
      { data: { answer: { choice: 'reject' }, reply: { to: other } }, context: { runId: anotherRun } },
    ]);
    expect(delivering.playbook.chat.posted().slice(2)).toMatchObject([
      { channel: theChannel, thread_ts: delivering.thread, text: recorded },
      { channel: theChannel, thread_ts: other, text: 'Auto recorded your answer: reject.' },
    ]);
  });
});
