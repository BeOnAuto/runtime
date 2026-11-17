import { describe, expect, it } from 'vitest';

import { askedRun, deliveringTo } from '../testing/delivered-conversations.ts';
import { answererId, conversationRows, recordsOf } from '../testing/index.ts';
import { theChannel } from '../testing/woken-conversations.ts';

const recorded = 'Auto recorded your answer: approve.';

const howToAnswer =
  "Auto couldn't take that as an answer. Reply with approve or reject. Anything after that word is kept as the note.";

const answeredAlready = "This request was already answered, so Auto didn't take this reply.";

const someoneElses = "This request is waiting for someone else's answer, so Auto didn't take this reply.";

describe('a delivered reply of the answerer', () => {
  it('that answers is recorded as a read reply is, said to be delivered and caused by the request it names, then marked and answered in its thread', async () => {
    const delivering = await deliveringTo();
    const approve = delivering.written('approve, looks good');

    const performed = await delivering.delivered([approve]);
    const [asked] = await recordsOf(delivering.playbook.ledger, 'run_deferred');
    const [answered] = await recordsOf(delivering.playbook.ledger, 'request_answered');
    const tellings = await recordsOf(delivering.playbook.ledger, 'telling_started');

    expect(performed).toEqual([{ id: approve.id, outcome: 'taken' }]);
    expect(answered).toMatchObject({
      data: {
        answer: { choice: 'approve', note: 'looks good' },
        reply: { id: approve.id, sender: answererId, to: delivering.thread },
        delivered: true,
      },
      causationId: asked?.id,
    });
    expect(delivering.playbook.chat.reactions()).toEqual([
      { channel: theChannel, timestamp: approve.id, name: 'white_check_mark' },
    ]);
    expect(delivering.lines()).toEqual([[delivering.thread, recorded]]);
    expect(tellings.map(({ data }) => data)).toMatchObject([
      { about: 'taken', form: 'mark' },
      { about: 'taken', form: 'line' },
    ]);
  });
});

describe('a delivered reply of the answerer that is no answer', () => {
  it('is refused and told why, said to be delivered', async () => {
    const delivering = await deliveringTo();
    const maybe = delivering.written('maybe');

    const performed = await delivering.delivered([maybe]);

    expect(performed).toEqual([{ id: maybe.id, outcome: 'refused' }]);
    expect(await recordsOf(delivering.playbook.ledger, 'reply_refused')).toMatchObject([
      {
        data: {
          server: 'chat',
          tool: 'thread_replies',
          reply: { id: maybe.id, sender: answererId },
          because: 'not_an_answer',
          told: true,
          delivered: true,
        },
      },
    ]);
    expect(delivering.lines()).toEqual([[delivering.thread, howToAnswer]]);
  });
});

describe('a delivered reply, beside the run and the timed reads', () => {
  it('that answers settles its run through the due work, as an answer a read took does', async () => {
    const delivering = await deliveringTo();

    await delivering.delivered([delivering.written('approve')]);
    await delivering.playbook.performDue(Date.now());

    expect(await delivering.playbook.runOf(askedRun)).toMatchObject({ output: { status: 'succeeded' } });
  });

  it('writes no read of the conversation and moves none of its rows, so its timed reads come as they would have', async () => {
    const delivering = await deliveringTo();
    const rows = await conversationRows(delivering.playbook.ledger);

    await delivering.delivered([delivering.written('maybe')]);

    expect(await recordsOf(delivering.playbook.ledger, 'replies_read', 'reading_failed')).toEqual([]);
    expect(await conversationRows(delivering.playbook.ledger)).toEqual(rows);
  });
});

describe('a delivered reply of anyone but the answerer', () => {
  it('whose words would answer is refused once as someone else’s, and told so', async () => {
    const delivering = await deliveringTo();
    const approve = delivering.written('approve', 'U0SOMEONE');

    const performed = await delivering.delivered([approve]);

    expect(performed).toEqual([{ id: approve.id, outcome: 'refused' }]);
    expect(await recordsOf(delivering.playbook.ledger, 'reply_refused')).toMatchObject([
      { data: { reply: { sender: 'U0SOMEONE' }, because: 'not_the_answerer', delivered: true } },
    ]);
    expect(delivering.lines()).toEqual([[delivering.thread, someoneElses]]);
  });

  it('that is chatter is passed over, recording and telling nothing', async () => {
    const delivering = await deliveringTo();
    const chatter = delivering.written('thanks, all', 'U0SOMEONE');

    const performed = await delivering.delivered([chatter]);

    expect(performed).toEqual([{ id: chatter.id, outcome: 'passed_over' }]);
    expect(await recordsOf(delivering.playbook.ledger, 'reply_refused', 'request_answered')).toEqual([]);
    expect(delivering.lines()).toEqual([]);
  });
});

describe('delivered replies of one conversation', () => {
  it('are taken oldest first, whatever order they come in, and a later reply is told after the answer’s mark and line that it changed nothing', async () => {
    const delivering = await deliveringTo();
    const approve = delivering.written('approve');
    const reject = delivering.written('reject');

    const performed = await delivering.delivered([reject, approve]);

    expect(performed).toEqual([
      { id: approve.id, outcome: 'taken' },
      { id: reject.id, outcome: 'passed_over' },
    ]);
    expect(await recordsOf(delivering.playbook.ledger, 'request_answered')).toMatchObject([
      { data: { reply: { id: approve.id } } },
    ]);
    expect(delivering.playbook.chat.reactions()).toMatchObject([{ timestamp: approve.id }]);
    expect(delivering.lines()).toEqual([
      [delivering.thread, recorded],
      [delivering.thread, answeredAlready],
    ]);
  });

  it('written at the same time are taken in the order of their ids', async () => {
    const delivering = await deliveringTo();
    const approve = delivering.written('approve');
    const reject = { ...delivering.written('reject'), time: approve.time };

    const performed = await delivering.delivered([reject, approve]);

    expect(performed.map(({ outcome }) => outcome)).toEqual(['taken', 'passed_over']);
    expect(await recordsOf(delivering.playbook.ledger, 'request_answered')).toMatchObject([
      { data: { answer: { choice: 'approve' } } },
    ]);
  });

  it('given twice in one delivery are one reply, performed once', async () => {
    const delivering = await deliveringTo();
    const maybe = delivering.written('maybe');

    const performed = await delivering.delivered([maybe, maybe]);

    expect(performed).toEqual([{ id: maybe.id, outcome: 'refused' }]);
    expect(await recordsOf(delivering.playbook.ledger, 'reply_refused')).toHaveLength(1);
  });
});

describe('a delivered reply taken as the answer whose mark the service refuses', () => {
  it('is said so with the run it answers, where the service refused the mark before it marked anything, and not where the mark may have been made', async () => {
    const refused = await deliveringTo();
    refused.playbook.chat.answerNext({ outcome: 'tool_error', detail: 'message_not_found', retryAfterMs: null });
    const unanswered = await deliveringTo();
    unanswered.playbook.chat.answerNext({
      outcome: 'timed_out',
      detail: 'The tool server did not answer in time',
      retryAfterMs: null,
    });
    const approveRefused = refused.written('approve');
    const approveUnanswered = unanswered.written('approve');

    expect([await refused.delivered([approveRefused]), await unanswered.delivered([approveUnanswered])]).toEqual([
      [{ id: approveRefused.id, outcome: 'taken', markRefused: { runId: askedRun } }],
      [{ id: approveUnanswered.id, outcome: 'taken' }],
    ]);
    expect(await recordsOf(refused.playbook.ledger, 'telling_failed')).toMatchObject([
      { data: { because: 'tool_error' } },
    ]);
  });
});
