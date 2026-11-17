import { describe, expect, it } from 'vitest';

import { deliveringTo } from '../testing/delivered-conversations.ts';
import { farAhead, recordsOf } from '../testing/index.ts';

const recorded = 'Auto recorded your answer: approve.';

const howToAnswer =
  "Auto couldn't take that as an answer. Reply with approve or reject. Anything after that word is kept as the note.";

const answeredAlready = "This request was already answered, so Auto didn't take this reply.";

describe('a reply a delivery brought and a timed read lists too', () => {
  it('taken by the delivery is taken by no read after it', async () => {
    const delivering = await deliveringTo();
    await delivering.delivered([delivering.written('approve')]);

    await delivering.playbook.performReads(Date.now() + farAhead);
    await delivering.playbook.performDue(Date.now() + farAhead);

    expect(await recordsOf(delivering.playbook.ledger, 'request_answered')).toHaveLength(1);
    expect(delivering.lines()).toEqual([[delivering.thread, recorded]]);
  });

  it('refused by the delivery is decided once, by the run’s rule, when a read lists it after, and told once', async () => {
    const delivering = await deliveringTo();
    await delivering.delivered([delivering.written('maybe')]);

    await delivering.playbook.performReads(Date.now() + farAhead);

    expect(await recordsOf(delivering.playbook.ledger, 'reply_refused')).toHaveLength(1);
    expect(await recordsOf(delivering.playbook.ledger, 'replies_read')).toMatchObject([
      { data: { taken: 0, refused: 0 } },
    ]);
    expect(delivering.lines()).toEqual([[delivering.thread, howToAnswer]]);
  });

  it('taken by a read is passed over by its delivery after it', async () => {
    const delivering = await deliveringTo();
    const approve = delivering.written('approve');
    await delivering.playbook.performReads(Date.now() + farAhead);

    const performed = await delivering.delivered([approve]);

    expect(performed).toEqual([{ id: approve.id, outcome: 'passed_over' }]);
    expect(await recordsOf(delivering.playbook.ledger, 'request_answered')).toHaveLength(1);
    expect(delivering.lines()).toEqual([[delivering.thread, recorded]]);
  });

  it('refused by a read is passed over by its delivery after it, and not told again', async () => {
    const delivering = await deliveringTo();
    const maybe = delivering.written('maybe');
    await delivering.playbook.performReads(Date.now() + farAhead);

    const performed = await delivering.delivered([maybe]);

    expect(performed).toEqual([{ id: maybe.id, outcome: 'passed_over' }]);
    expect(await recordsOf(delivering.playbook.ledger, 'reply_refused')).toHaveLength(1);
    expect(delivering.lines()).toEqual([[delivering.thread, howToAnswer]]);
  });
});

describe('a reply no delivery brought', () => {
  it('is taken by the timed read, as before, and its facts do not say it was delivered', async () => {
    const delivering = await deliveringTo();
    delivering.written('maybe');
    delivering.written('approve');

    await delivering.playbook.performReads(Date.now() + farAhead);
    const facts = await recordsOf(delivering.playbook.ledger, 'reply_refused', 'request_answered');

    expect(facts).toHaveLength(2);
    expect(facts.map(({ data }) => data)).not.toContainEqual(expect.objectContaining({ delivered: true }));
  });
});

describe('a reply of the answerer delivered after a read took the answer', () => {
  it('is told once that the request was already answered, after the answer’s own mark and line', async () => {
    const delivering = await deliveringTo();
    delivering.written('approve');
    await delivering.playbook.performReads(Date.now() + farAhead);

    const performed = await delivering.delivered([delivering.written('reject')]);

    expect(performed).toMatchObject([{ outcome: 'passed_over' }]);
    expect(delivering.lines()).toEqual([
      [delivering.thread, recorded],
      [delivering.thread, answeredAlready],
    ]);
  });
});
