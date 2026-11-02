import type { Outcome } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { commenting, minute, reader, step } from '../testing/commenting.ts';
import { ada, listedOf, markedOf, outputOf, priya } from '../testing/harness.ts';

const later = '2026-11-02T12:00:00.000Z';

const block = 'finance/runs/019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e/result/2';

async function commented() {
  const scene = await commenting();
  const onStep = await scene.made(step, minute(1), priya);
  const onBlock = await scene.made(block, minute(2), reader);
  return { ...scene, onStep, onBlock };
}

async function commentedInOrg() {
  const scene = await commented();
  await scene.madeInOrg('org/connections/019a3f10-2b4c-7d5e-8f60-718293a4b5c6', minute(3), priya);
  const onOrg = await scene.madeInOrg('org', minute(2), reader);
  return { ...scene, onOrg };
}

const rowOf = (outcome: Outcome, address: string) => listedOf(outcome).rows.find((row) => row.address === address);

describe('a comment reopened, in the activity', () => {
  it('is listed again at its reopening, still by its maker, new to everyone but its reopener, its maker among them', async () => {
    const { list, resolve, reopen, onStep } = await commented();
    await resolve(onStep, 'acted', ada, minute(30));
    await reopen(onStep, reader, minute(40));
    const address = `finance/comments/${onStep}`;
    const row = { address, at: minute(40), by: priya.id };

    expect([
      rowOf(await list(ada, { kind: 'comment' }, later), address),
      rowOf(await list(priya, { kind: 'comment' }, later), address),
      rowOf(await list(reader, { kind: 'comment', playbook: 'finance' }, later), address),
    ]).toMatchObject([
      { ...row, seen: false },
      { ...row, seen: false },
      { ...row, seen: true },
    ]);
  });

  it('is kept by mine for its maker, not its reopener', async () => {
    const { list, resolve, reopen, onStep } = await commented();
    await resolve(onStep, 'acted', ada, minute(30));
    await reopen(onStep, reader, minute(40));
    const addresses = async (caller: typeof ada) =>
      listedOf(await list(caller, { kind: 'comment', mine: 'true', playbook: 'finance' }, later)).rows.map(
        ({ address }) => address,
      );

    expect([await addresses(priya), await addresses(ada)]).toEqual([[`finance/comments/${onStep}`], []]);
  });
});

describe('a comment reopened, in the counts', () => {
  it('is counted again for everyone but its reopener, its maker among them, until marked seen at its reopening', async () => {
    const { list, mark, resolve, reopen, onStep } = await commented();
    await resolve(onStep, 'acted', ada, minute(30));
    const resolved = listedOf(await list(priya, {}, later)).counts.comments;
    await reopen(onStep, ada, minute(40));
    const reopened = [
      listedOf(await list(priya, {}, later)).counts.comments,
      listedOf(await list(ada, {}, later)).counts.comments,
    ];
    const marked = markedOf(
      await mark(priya, { items: [{ address: `finance/comments/${onStep}`, at: minute(40) }] }, later),
    );

    expect([resolved, ...reopened, marked.counts.comments]).toEqual([1, 2, 1, 1]);
  });

  it('is counted again by one who marked it seen before it was resolved', async () => {
    const { list, mark, resolve, reopen, onBlock } = await commented();
    await mark(ada, { items: [{ address: `finance/comments/${onBlock}`, at: minute(2) }] }, later);
    const before = listedOf(await list(ada, {}, later)).counts.comments;
    await resolve(onBlock, 'acted', priya, minute(30));
    await reopen(onBlock, priya, minute(40));

    expect([before, listedOf(await list(ada, {}, later)).counts.comments]).toEqual([1, 2]);
  });
});

describe("the organization's own comment reopened, in the activity", () => {
  it('is listed again at its reopening, by its maker', async () => {
    const { list, resolveInOrg, reopenInOrg, onOrg } = await commentedInOrg();
    await resolveInOrg(onOrg, 'acted');
    await reopenInOrg(onOrg, priya, minute(50));

    expect(outputOf(await list(ada, { kind: 'comment' }, later))).toMatchObject({
      rows: [
        {
          address: `org/comments/${onOrg}`,
          playbook: null,
          at: minute(50),
          by: reader.id,
          by_name: reader.name,
          seen: false,
        },
        {},
        {},
        {},
      ],
    });
  });
});
