import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { commentDecider } from '../facts/comment-facts.ts';
import { addressesIn, commenting, minute, reader, run, step } from '../testing/commenting.ts';
import { ada, outputOf, priya } from '../testing/harness.ts';
import { reopenComment, reopenCommentInOrg } from './reopen-comment.ts';

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
