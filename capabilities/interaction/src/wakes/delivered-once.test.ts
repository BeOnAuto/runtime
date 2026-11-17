import type { OneCall } from '@on.auto/tool-servers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { deliveringTo, throughTheProvider } from '../testing/delivered-conversations.ts';
import { farAhead, recordsOf } from '../testing/index.ts';

const recorded = 'Auto recorded your answer: approve.';

const howToAnswer =
  "Auto couldn't take that as an answer. Reply with approve or reject. Anything after that word is kept as the note.";

const answeredAlready = "This request was already answered, so Auto didn't take this reply.";

const holdMs = 140_000;

const pastTheRoomOfACall = 80_000;

function stoppedAtTheMark({ reference }: OneCall): Effect.Effect<unknown> {
  return reference.tool === 'add_reaction' ? Effect.die(new Error('The runtime stopped')) : Effect.void;
}

describe('a reply delivered again', () => {
  it('after it was taken is passed over by its id, and never told the request was already answered', async () => {
    const delivering = await deliveringTo();
    const approve = delivering.written('approve');
    await delivering.delivered([approve]);

    const performed = await delivering.delivered([approve]);

    expect(performed).toEqual([{ id: approve.id, outcome: 'passed_over' }]);
    expect(await recordsOf(delivering.playbook.ledger, 'request_answered')).toHaveLength(1);
    expect(delivering.lines()).toEqual([[delivering.thread, recorded]]);
  });

  it('after it was refused is passed over by its id, also once the request is answered', async () => {
    const delivering = await deliveringTo();
    const maybe = delivering.written('maybe');
    await delivering.delivered([maybe]);
    await delivering.delivered([maybe]);
    await delivering.delivered([delivering.written('approve')]);

    const performed = await delivering.delivered([maybe]);

    expect(performed).toEqual([{ id: maybe.id, outcome: 'passed_over' }]);
    expect(await recordsOf(delivering.playbook.ledger, 'reply_refused')).toHaveLength(1);
    expect(delivering.lines()).toEqual([
      [delivering.thread, howToAnswer],
      [delivering.thread, recorded],
    ]);
  });
});

describe('a reply of the answerer delivered after the answer, in another delivery', () => {
  it('is told once that the request was already answered, and the next is told nothing', async () => {
    const delivering = await deliveringTo();
    await delivering.delivered([delivering.written('approve')]);

    const performed = await delivering.delivered([delivering.written('reject')]);
    await delivering.delivered([delivering.written('reject, really')]);

    expect(performed).toMatchObject([{ outcome: 'passed_over' }]);
    expect(await recordsOf(delivering.playbook.ledger, 'request_answered', 'reply_refused')).toHaveLength(1);
    expect(delivering.lines()).toEqual([
      [delivering.thread, recorded],
      [delivering.thread, answeredAlready],
    ]);
  });

  it('is told nothing while the answer’s own telling is still due, and told once it was made', async () => {
    const delivering = await deliveringTo();
    const takenAt = Date.now() - pastTheRoomOfACall;
    const [taken] = await delivering.delivered([delivering.written('approve')], takenAt);

    await delivering.delivered([delivering.written('reject')]);
    const whileDue = delivering.lines();
    await delivering.playbook.performDue(Date.now());
    await delivering.delivered([delivering.written('reject, really')]);

    expect(taken).toMatchObject({ outcome: 'taken' });
    expect(whileDue).toEqual([]);
    expect(delivering.lines()).toEqual([
      [delivering.thread, recorded],
      [delivering.thread, answeredAlready],
    ]);
  });

  it('is told nothing where a telling of the request before its answer is not known', async () => {
    const delivering = await deliveringTo();
    delivering.playbook.chat.answerNext({ outcome: 'timed_out', detail: 'No answer in time', retryAfterMs: null });
    await delivering.delivered([delivering.written('maybe')]);
    await delivering.delivered([delivering.written('approve')]);

    const performed = await delivering.delivered([delivering.written('reject')]);

    expect(performed).toMatchObject([{ outcome: 'passed_over' }]);
    expect(delivering.lines()).toEqual([[delivering.thread, recorded]]);
  });
});

describe('a reply of anyone but the answerer delivered after the answer', () => {
  it('is refused by the run’s rule, recording and telling nothing', async () => {
    const delivering = await deliveringTo();
    await delivering.delivered([delivering.written('approve')]);

    const performed = await delivering.delivered([delivering.written('reject', 'U0SOMEONE')]);

    expect(performed).toMatchObject([{ outcome: 'passed_over' }]);
    expect(await recordsOf(delivering.playbook.ledger, 'reply_refused')).toEqual([]);
    expect(delivering.lines()).toEqual([[delivering.thread, recorded]]);
  });
});

describe('the hold of a delivery that takes an answer', () => {
  it('keeps the due work from telling the answer until it has passed, where the delivery stopped part-way, and nothing is made twice', async () => {
    const delivering = await deliveringTo({ ...throughTheProvider, duringCall: stoppedAtTheMark });
    const heldAt = Date.now();

    await expect(delivering.delivered([delivering.written('approve')], heldAt)).rejects.toThrow('The runtime stopped');
    await delivering.playbook.performDue(heldAt + holdMs - 1);
    const withinTheHold = delivering.lines();
    await delivering.playbook.performDue(heldAt + holdMs);
    await delivering.playbook.performDue(heldAt + 2 * holdMs);

    expect(withinTheHold).toEqual([]);
    expect(delivering.playbook.chat.reactions()).toHaveLength(1);
    expect(delivering.lines()).toEqual([[delivering.thread, recorded]]);
  });

  it('starts no telling without the room for a call, and leaves a refusal it cannot tell unrecorded, with every reply after it', async () => {
    const delivering = await deliveringTo();
    const maybe = delivering.written('maybe');
    const perhaps = delivering.written('perhaps');

    const performed = await delivering.delivered([maybe, perhaps], Date.now() - pastTheRoomOfACall);
    const recordedThen = await recordsOf(delivering.playbook.ledger, 'reply_refused');
    const again = await delivering.delivered([maybe, perhaps]);

    expect(performed).toEqual([
      { id: maybe.id, outcome: 'unrecorded' },
      { id: perhaps.id, outcome: 'unrecorded' },
    ]);
    expect(recordedThen).toEqual([]);
    expect(again.map(({ outcome }) => outcome)).toEqual(['refused', 'refused']);
  });

  it('leaves the answer’s telling to the due work where it has no room for it', async () => {
    const delivering = await deliveringTo();

    await delivering.delivered([delivering.written('approve')], Date.now() - pastTheRoomOfACall);
    const toldThen = [delivering.playbook.chat.reactions(), delivering.lines()];
    await delivering.playbook.performDue(Date.now() + farAhead);

    expect(toldThen).toEqual([[], []]);
    expect(delivering.playbook.chat.reactions()).toHaveLength(1);
    expect(delivering.lines()).toEqual([[delivering.thread, recorded]]);
  });
});
