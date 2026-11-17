import type { Outcome } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { commentDecider } from '../facts/comment-facts.ts';
import { addressesIn, commenting, minute, reader, run, step } from '../testing/commenting.ts';
import { ada, listedOf, markedOf, outputOf, priya } from '../testing/harness.ts';
import { reopenComment, reopenCommentInOrg } from './reopen-comment.ts';

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

const inStudio: unknown = expect.stringContaining('studio.example');

describe('the registration of reopen_comment', () => {
  it('is a repeatable command at POST /comments/{id}/reopen of the playbook and of the org, with no body, over HTTP alone, for any reader', () => {
    expect(
      [reopenComment, reopenCommentInOrg].map(({ registration }) => [
        registration.scope,
        registration.kind,
        registration.name,
        registration.route,
        registration.permissions,
        registration.repeatable,
        registration.servedOverHttpAlone,
      ]),
    ).toEqual([
      [
        'playbook',
        'command',
        'reopen_comment',
        { method: 'POST', path: '/comments/{id}/reopen' },
        ['playbook:read'],
        true,
        { kind: 'none' },
      ],
      [
        'org',
        'command',
        'reopen_comment',
        { method: 'POST', path: '/comments/{id}/reopen' },
        ['org:read', 'playbook:read'],
        true,
        { kind: 'none' },
      ],
    ]);
  });
});

describe('reopen_comment', () => {
  it('opens a resolved comment again, saying when and by whom, and answers it whole', async () => {
    const { made, resolve, reopen, comments } = await commenting();
    const id = await made(step, minute(1), priya);
    await resolve(id, 'acted', ada, minute(31));

    expect(outputOf(await reopen(id.toUpperCase(), reader, minute(41)))).toEqual({
      id,
      address: step,
      text: `About ${step}`,
      anchor: null,
      by: priya.id,
      by_name: priya.name,
      at: minute(1),
      open: true,
      resolved_at: null,
      resolved_by: null,
      resolved_how: null,
      reopened_at: minute(41),
      reopened_by: reader.id,
      studio: inStudio,
    });
    expect([addressesIn(await comments()), addressesIn(await comments({ open: 'false' }))]).toEqual([[step], []]);
  });

  it('records nothing for a comment open already, and answers it as it stands', async () => {
    const { made, reopen, ledger } = await commenting();
    const id = await made(step, minute(1));

    expect(outputOf(await reopen(id))).toMatchObject({ open: true, reopened_at: null, reopened_by: null });
    expect(
      (await Effect.runPromise(ledger.service.load(`playbook/acme/finance/comments/${id}`, commentDecider))).version,
    ).toBe(1);
  });
});

describe('reopen_comment, over and over', () => {
  it('resolves and reopens one comment as often as people ask, keeping the last reopening', async () => {
    const { made, resolve, reopen } = await commenting();
    const id = await made(step, minute(1));
    await resolve(id, 'acted', ada, minute(2));
    await reopen(id, reader, minute(3));
    await resolve(id, 'dismissed', reader, minute(4));

    expect([outputOf(await resolve(id, 'acted')), outputOf(await reopen(id, ada, minute(5)))]).toMatchObject([
      { open: false, resolved_how: 'dismissed', resolved_at: minute(4), reopened_at: minute(3) },
      { open: true, resolved_how: null, reopened_at: minute(5), reopened_by: ada.id },
    ]);
  });
});

describe('reopen_comment, given what it cannot take', () => {
  it('refuses an id that is no UUID, and finds no comment the scope does not hold', async () => {
    const { made, madeInOrg, reopen, reopenInOrg } = await commenting();
    const ofThePlaybook = await made(step, minute(1));
    const ofTheOrg = await madeInOrg('org', minute(2));

    expect(
      await Promise.all([reopen('not-an-id'), reopen(run), reopen(ofTheOrg), reopenInOrg(ofThePlaybook)]),
    ).toMatchObject([
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/id' }] },
      { status: 'rejected', reason: 'not_found' },
      { status: 'rejected', reason: 'not_found' },
      { status: 'rejected', reason: 'not_found' },
    ]);
  });
});

describe("the organization's reopen_comment", () => {
  it("opens one of the organization's own comments again", async () => {
    const { madeInOrg, resolveInOrg, reopenInOrg, commentsInOrg } = await commenting();
    const id = await madeInOrg('org/settings/billing', minute(1));
    await resolveInOrg(id, 'dismissed');

    expect(outputOf(await reopenInOrg(id, priya, minute(41)))).toMatchObject({
      id,
      open: true,
      resolved_how: null,
      reopened_at: minute(41),
      reopened_by: priya.id,
    });
    expect(addressesIn(await commentsInOrg())).toEqual(['org/settings/billing']);
  });
});
