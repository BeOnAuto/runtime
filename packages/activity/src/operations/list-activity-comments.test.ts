import { describe, expect, it } from 'vitest';

import { commenting, minute, reader, run, step } from '../testing/commenting.ts';
import { ada, listedOf, markedOf, outputOf, priya } from '../testing/harness.ts';

const later = '2026-11-02T12:00:00.000Z';

const block = `finance/runs/${run}/result/2`;

const aComment: unknown = expect.stringMatching(/^finance\/comments\//u);

async function commented() {
  const scene = await commenting();
  const onStep = await scene.made(step, minute(1), priya);
  const onBlock = await scene.made(block, minute(2), reader);
  return { ...scene, onStep, onBlock };
}

describe('the comments in the activity of the org', () => {
  it('lists each open comment as a row of its own, naming what it is about, who made it and the first line it says', async () => {
    const { list, make, onStep, onBlock } = await commented();
    await make(priya, { address: `finance/${run}`, text: `First line\n${'more '.repeat(10)}` }, minute(3));
    const { rows } = listedOf(await list(ada, { kind: 'comment' }, later));

    expect(outputOf(await list(ada, { kind: 'comment', limit: '3' }, later))).toMatchObject({
      rows: [
        {
          kind: 'comment',
          address: aComment,
          message: 'First line',
          definition: null,
          run_id: run,
          about: `finance/${run}`,
        },
        {
          kind: 'comment',
          address: `finance/comments/${onBlock}`,
          playbook: 'finance',
          at: minute(2),
          by: reader.id,
          by_name: reader.name,
          change: null,
          trigger: null,
          definition: null,
          run_id: run,
          output_shape: null,
          message: `About ${block}`,
          answer_schema: null,
          detail: null,
          status: null,
          waits_on: null,
          expires_at: null,
          about: block,
          seen: false,
        },
        {
          address: `finance/comments/${onStep}`,
          by_name: priya.name,
          definition: { type: 'workflow', name: 'close-the-week', version: 4 },
          run_id: null,
          about: step,
          seen: false,
        },
      ],
    });
    expect(rows).toHaveLength(3);
  });
});

describe('the comment rows of the activity, in particular', () => {
  it('cut the first line of a long comment to 200 characters, and reads nothing from an address it cannot read', async () => {
    const { list, make, record } = await commenting();
    await make(priya, { address: step, text: 'x'.repeat(300) }, minute(1));
    await record('playbook/acme/finance/comments/019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f', {
      type: 'comment_made',
      data: { address: 'finance/somewhere', text: 'Here.', made_by: { id: priya.id, name: priya.name } },
      context: { at: minute(2), by: priya.id },
    });

    expect(outputOf(await list(ada, { kind: 'comment' }, later))).toMatchObject({
      rows: [{ about: 'finance/somewhere', definition: null, run_id: null }, { message: `${'x'.repeat(199)}…` }],
    });
  });

  it('leave a comment out once it is resolved, and with mine keeps the comments the caller made', async () => {
    const { list, resolve, onStep, onBlock } = await commented();

    expect(
      listedOf(await list(reader, { kind: 'comment', mine: 'true', playbook: 'finance' }, later)).rows,
    ).toMatchObject([{ address: `finance/comments/${onBlock}`, seen: true }]);
    await resolve(onBlock, 'acted');
    expect(listedOf(await list(ada, { kind: 'new,comment' }, later)).rows.map(({ address }) => address)).toEqual([
      `finance/comments/${onStep}`,
      expect.stringMatching(/^playbooks\/sales\//u),
      expect.stringMatching(/^playbooks\/finance\//u),
    ]);
  });
});

describe('the comments the activity counts', () => {
  it('counts the open comments others made that the caller has not seen', async () => {
    const { list } = await commented();

    expect([
      listedOf(await list(ada, {}, later)).counts.comments,
      listedOf(await list(priya, {}, later)).counts.comments,
      listedOf(await list(reader, { playbook: 'finance' }, later)).counts.comments,
    ]).toEqual([2, 1, 1]);
  });

  it('counts a comment no more once the caller marks it seen, or anyone resolves it', async () => {
    const { list, mark, resolve, onStep } = await commented();
    const marked = markedOf(
      await mark(ada, { items: [{ address: `finance/comments/${onStep}`, at: minute(1) }] }, later),
    );
    const seen = listedOf(await list(ada, { kind: 'comment' }, later)).rows.map(({ seen: each }) => each);
    await resolve(onStep, 'dismissed');

    expect(marked.counts.comments).toBe(1);
    expect(seen).toEqual([false, true]);
    expect(listedOf(await list(priya, {}, later)).counts.comments).toBe(1);
    expect(listedOf(await list(ada, {}, later)).counts.comments).toBe(1);
  });

  it('counts nothing at or before the place the caller marked everything seen through, a comment at that very time included', async () => {
    const { list, mark, make } = await commented();
    const [newest] = listedOf(await list(ada, { kind: 'comment' }, later)).rows;
    await make(priya, { address: step, text: 'At the same time.' }, minute(2));
    const marked = markedOf(await mark(ada, { through: String(newest?.cursor) }, later));

    expect(marked.counts.comments).toBe(1);
    expect(listedOf(await list(ada, { kind: 'comment' }, later)).rows.map(({ seen }) => seen)).toEqual([
      false,
      true,
      true,
    ]);
  });
});
