import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { commentDecider } from '../facts/comment-facts.ts';
import { addressesIn, commentOf, commenting, listedOf, minute, reader, run, step } from '../testing/commenting.ts';
import { outputOf, priya, studioPageOf } from '../testing/harness.ts';
import { listCommentsInOrg } from './list-comments.ts';
import { makeCommentInOrg } from './make-comment.ts';
import { resolveCommentInOrg } from './resolve-comment.ts';

const connection = '019a3f10-2b4c-7d5e-8f60-718293a4b5c6';

const onConnection = `org/connections/${connection}`;

const text = 'The CRM stopped answering on Friday. Can you get it connected again?';

describe("the organization's operations of comments", () => {
  it('are its make_comment, over HTTP alone and answering 201, list_comments and resolve_comment, for any reader of the org', () => {
    expect(
      [makeCommentInOrg, listCommentsInOrg, resolveCommentInOrg].map(({ registration }) => [
        registration.scope,
        registration.kind,
        registration.name,
        registration.targetsPlaybook,
        registration.permissions,
      ]),
    ).toEqual([
      ['org', 'command', 'make_comment', false, ['org:read', 'playbook:read']],
      ['org', 'query', 'list_comments', false, ['org:read', 'playbook:read']],
      ['org', 'command', 'resolve_comment', false, ['org:read', 'playbook:read']],
    ]);
    expect(makeCommentInOrg.registration).toMatchObject({ successStatus: 201, servedOverHttpAlone: { kind: 'json' } });
  });
});

describe("the organization's make_comment", () => {
  it("records a comment on one of the organization's things on the org, by a reader of some playbooks alone, with its place in Studio", async () => {
    const { makeInOrg, ledger } = await commenting();
    const anchor = { x: 0.18, y: 0.5 };
    const made = await makeInOrg(reader, { address: onConnection, text: `  ${text}\n`, anchor }, minute(20));
    const { id } = commentOf(made);

    expect(outputOf(made)).toEqual({
      id,
      address: onConnection,
      text,
      anchor,
      by: reader.id,
      by_name: reader.name,
      at: minute(20),
      open: true,
      resolved_at: null,
      resolved_by: null,
      resolved_how: null,
      reopened_at: null,
      reopened_by: null,
      studio: studioPageOf({ kind: 'org_comment', comment: id, settings: 'connections' }),
    });
    expect(
      (await Effect.runPromise(ledger.service.load(`org/acme/comments/${id}`, commentDecider))).state,
    ).toMatchObject({ address: onConnection, anchor });
  });
});

describe("the place in Studio of a comment of the organization's own", () => {
  it('opens Studio at the home for the organization, and at the page of Settings for a page, a member or a part', async () => {
    const { makeInOrg } = await commenting();
    const addresses = ['org', 'org/parts/playbooks', 'org/settings/billing', 'org/members/user_2kLm7Qx/parts/role'];
    const made = await Promise.all(addresses.map((address) => makeInOrg(priya, { address, text })));
    const ids = made.map((outcome) => commentOf(outcome).id);

    expect(made.map((outcome) => outputOf(outcome))).toMatchObject([
      { studio: studioPageOf({ kind: 'org_comment', comment: String(ids[0]) }) },
      { studio: studioPageOf({ kind: 'org_comment', comment: String(ids[1]) }) },
      { studio: studioPageOf({ kind: 'org_comment', comment: String(ids[2]), settings: 'billing' }) },
      { studio: studioPageOf({ kind: 'org_comment', comment: String(ids[3]), settings: 'members' }) },
    ]);
  });
});

describe("the organization's make_comment, given an address it cannot take", () => {
  it("refuses an address of a playbook's things, of no form, or of the activity, at /address", async () => {
    const { makeInOrg } = await commenting();
    const refused = await Promise.all(
      ['playbooks/finance', step, `org/${run}`, 'org/somewhere', `org/comments/${run}`].map((address) =>
        makeInOrg(priya, { address, text }),
      ),
    );

    expect(refused).toMatchObject(
      Array.from({ length: 5 }, () => ({
        status: 'rejected',
        reason: 'invalid_input',
        issues: [{ pointer: '/address' }],
      })),
    );
  });
});

describe("the organization's list_comments", () => {
  it("lists the organization's own comments and none of its playbooks', under a thing its parts alone", async () => {
    const { madeInOrg, made, commentsInOrg } = await commenting();
    await madeInOrg('org', minute(1));
    await madeInOrg('org/parts/playbooks', minute(2));
    await madeInOrg(onConnection, minute(3));
    await madeInOrg(`${onConnection}/parts/tools`, minute(4));
    await made('playbooks/finance', minute(5));

    expect(addressesIn(await commentsInOrg())).toEqual([
      `${onConnection}/parts/tools`,
      onConnection,
      'org/parts/playbooks',
      'org',
    ]);
    expect(addressesIn(await commentsInOrg({ address: 'org', under: 'true' }))).toEqual(['org/parts/playbooks', 'org']);
    expect(addressesIn(await commentsInOrg({ address: onConnection }))).toEqual([onConnection]);
  });

  it('reads on page by page, and refuses a cursor of a playbook, an address of a playbook and under without an address', async () => {
    const { madeInOrg, made, comments, commentsInOrg } = await commenting();
    await madeInOrg('org', minute(1));
    await madeInOrg('org/settings/billing', minute(2));
    await made('playbooks/finance', minute(3));
    await made(step, minute(4));
    const first = listedOf(await commentsInOrg({ limit: '1' }));
    const last = listedOf(await commentsInOrg({ limit: '1', cursor: String(first.next_cursor) }));
    const ofThePlaybook = listedOf(await comments({ limit: '1' })).next_cursor;

    expect([...first.comments, ...last.comments].map(({ address }) => address)).toEqual([
      'org/settings/billing',
      'org',
    ]);
    expect(last.next_cursor).toBeNull();
    expect(
      await Promise.all([
        commentsInOrg({ cursor: String(ofThePlaybook) }),
        comments({ cursor: String(first.next_cursor) }),
        commentsInOrg({ address: 'playbooks/finance' }),
        commentsInOrg({ under: 'true' }),
      ]),
    ).toMatchObject([
      { reason: 'invalid_input', issues: [{ pointer: '/cursor' }] },
      { reason: 'invalid_input', issues: [{ pointer: '/cursor' }] },
      { reason: 'invalid_input', issues: [{ pointer: '/address' }] },
      { reason: 'invalid_input', issues: [{ pointer: '/under' }] },
    ]);
  });
});

describe("the organization's resolve_comment", () => {
  it("closes one of the organization's own comments, and finds none of a playbook's", async () => {
    const { madeInOrg, made, resolveInOrg, commentsInOrg } = await commenting();
    const own = await madeInOrg(onConnection, minute(1));
    const playbooks = await made(step, minute(2));

    expect(outputOf(await resolveInOrg(own, 'acted', reader, minute(31)))).toMatchObject({
      id: own,
      open: false,
      resolved_by: reader.id,
      resolved_how: 'acted',
    });
    expect(await resolveInOrg(playbooks, 'acted')).toMatchObject({ status: 'rejected', reason: 'not_found' });
    expect(addressesIn(await commentsInOrg({ open: 'false' }))).toEqual([onConnection]);
  });
});
