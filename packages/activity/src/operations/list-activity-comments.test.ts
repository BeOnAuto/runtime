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

const connection = '019a3f10-2b4c-7d5e-8f60-718293a4b5c6';

async function commentedInOrg() {
  const scene = await commented();
  const onConnection = await scene.madeInOrg(`org/connections/${connection}`, minute(3), priya);
  const onOrg = await scene.madeInOrg('org', minute(2), reader);
  return { ...scene, onConnection, onOrg };
}

describe("the organization's own comments in the activity", () => {
  it("are listed to a caller who may access every playbook, with no playbook, merged with the playbooks' by at", async () => {
    const { list, onConnection, onOrg, onBlock, onStep } = await commentedInOrg();
    const read = outputOf(await list(ada, { kind: 'comment' }, later));

    expect(listedOf(await list(ada, { kind: 'comment' }, later)).rows.map(({ address }) => address)).toEqual([
      `org/comments/${onConnection}`,
      `finance/comments/${onBlock}`,
      `org/comments/${onOrg}`,
      `finance/comments/${onStep}`,
    ]);
    expect(read).toMatchObject({
      rows: [
        {
          kind: 'comment',
          playbook: null,
          by: priya.id,
          definition: null,
          run_id: null,
          message: `About org/connections/${connection}`,
          about: `org/connections/${connection}`,
          seen: false,
        },
        {},
        { playbook: null, about: 'org', seen: false },
        {},
      ],
    });
  });

  it('are left out for a playbook asked, and for a caller who may access some playbooks alone', async () => {
    const { list } = await commentedInOrg();
    const addresses = async (caller: typeof ada, input: Readonly<Record<string, string>>) =>
      listedOf(await list(caller, input, later)).rows.map(({ address }) => address);

    expect(
      [
        ...(await addresses(ada, { kind: 'comment', playbook: 'finance' })),
        ...(await addresses(reader, { kind: 'comment', playbook: 'finance' })),
      ].filter((address) => address.startsWith('org/')),
    ).toEqual([]);
    expect(listedOf(await list(reader, { playbook: 'finance' }, later)).counts.comments).toBe(1);
  });
});

describe("the organization's own comments in the counts and the cursors of the activity", () => {
  it('are counted for a caller who may access every playbook, until marked seen or resolved', async () => {
    const { list, mark, resolveInOrg, onConnection, onOrg } = await commentedInOrg();
    const counted = listedOf(await list(ada, { playbook: 'finance' }, later)).counts.comments;
    const marked = markedOf(
      await mark(ada, { items: [{ address: `org/comments/${onConnection}`, at: minute(3) }] }, later),
    );
    const seen = listedOf(await list(ada, { kind: 'comment' }, later)).rows.map(({ seen: each }) => each);
    await resolveInOrg(onOrg, 'acted');

    expect([counted, marked.counts.comments]).toEqual([4, 3]);
    expect(seen).toEqual([true, false, false, false]);
    expect(listedOf(await list(ada, {}, later)).counts.comments).toBe(2);
  });

  it('read on through a cursor and are marked seen through one that names a row of the organization', async () => {
    const { list, mark, onConnection, onOrg, onStep } = await commentedInOrg();
    const first = listedOf(await list(ada, { kind: 'comment', limit: '3' }, later));
    const rest = listedOf(await list(ada, { kind: 'comment', cursor: String(first.next_cursor) }, later));
    const since = listedOf(await list(ada, { kind: 'comment', since: String(first.rows[2]?.cursor) }, later));
    const marked = markedOf(await mark(ada, { through: String(first.rows[2]?.cursor) }, later));

    expect(first.rows.at(-1)?.address).toBe(`org/comments/${onOrg}`);
    expect(rest.rows.map(({ address }) => address)).toEqual([`finance/comments/${onStep}`]);
    expect(since.rows).toHaveLength(2);
    expect(since.rows[0]?.address).toBe(`org/comments/${onConnection}`);
    expect(marked).toMatchObject({ counts: { comments: 2 }, through: { cursor: first.rows[2]?.cursor } });
  });
});
