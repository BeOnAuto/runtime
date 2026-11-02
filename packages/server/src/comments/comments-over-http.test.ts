import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import {
  addressesOn,
  commentKeys,
  commentOf,
  commentedPlaybook,
  commentsOf,
  type CommentedPlaybook,
} from './commented-playbook.ts';

let server: ReasoningServer;

let commented: CommentedPlaybook;

let addresses: ReturnType<typeof addressesOn>;

beforeEach(async () => {
  server = await servingReasoning([], commentKeys);
  commented = await commentedPlaybook(server);
  addresses = addressesOn(commented);
});

afterEach(async () => {
  await server.stop();
});

function commentMade(address: string, text = `About ${address}`) {
  const { ofTheReader } = commented;
  return ofTheReader.call('POST', `${ofTheReader.playbook}/comments`, { address, text });
}

async function made(address: string) {
  return commentOf((await commentMade(address)).body);
}

async function listed(query = '') {
  const { ofTheAdmin } = commented;
  return commentsOf((await ofTheAdmin.call('GET', `${ofTheAdmin.playbook}/comments${query}`)).body);
}

function resolved(id: string, how: string) {
  const { ofTheAdmin } = commented;
  return ofTheAdmin.call('POST', `${ofTheAdmin.playbook}/comments/${id}/resolve`, { how });
}

const ChangesSchemaOf = Schema.decodeUnknownSync(
  Schema.Struct({ cursor: Schema.String, changes: Schema.Array(Schema.Record(Schema.String, Schema.String)) }),
);

const under = (address: string) => `?address=${encodeURIComponent(address)}&under=true`;

describe('a comment made over HTTP', () => {
  it('is made by a reader of the playbook, answering 201 with the comment and its place in Studio', async () => {
    const answer = await commentMade(addresses.step, '  Flag any entry over $10,000.  ');
    const { id } = commentOf(answer.body);
    const atTheStep: unknown = expect.stringMatching(
      new RegExp(`playbook=alpha&workflow=approval&version=1&step=do%2F0%2Fapprove&comment=${id}$`, 'u'),
    );

    expect(answer).toMatchObject({
      status: 201,
      body: {
        address: addresses.step,
        text: 'Flag any entry over $10,000.',
        by: 'acme-reader',
        by_name: 'acme-reader',
        open: true,
        resolved_at: null,
        resolved_by: null,
        resolved_how: null,
        studio: atTheStep,
      },
    });
  });

  it('is made on a definition at a version, a step, a run, an event of it, a block of its result, its request and the playbook', async () => {
    const answers = await Promise.all(Object.values(addresses).map((address) => commentMade(address)));

    expect(answers.map(({ status }) => status)).toEqual([201, 201, 201, 201, 201, 201, 201]);
    expect((await listed()).comments).toHaveLength(7);
  });
});

describe('the comments listed over HTTP', () => {
  it('are those on one address, or under it: a run with its events and its blocks, a version with its steps', async () => {
    await Object.values(addresses).reduce(
      (done: Promise<unknown>, address) => done.then(() => made(address)),
      Promise.resolve(),
    );
    const addressesIn = async (query: string) => (await listed(query)).comments.map(({ address }) => address);

    expect(await addressesIn(`?address=${encodeURIComponent(addresses.run)}`)).toEqual([addresses.run]);
    expect(await addressesIn(under(addresses.run))).toEqual([addresses.block, addresses.event, addresses.run]);
    expect(await addressesIn(under('alpha/definitions/workflow/approval/1'))).toEqual([addresses.step]);
    expect(await addressesIn(under('alpha/definitions/computation/tally'))).toEqual([addresses.version]);
    expect(await listed('?limit=2')).toMatchObject({ has_more: true });
  });
});

describe('a comment resolved over HTTP', () => {
  it('is closed, leaves the open comments, and resolved again records nothing and answers as it stands', async () => {
    const { id } = await made(addresses.run);
    const first = await resolved(id, 'acted');
    const again = await resolved(id, 'dismissed');

    expect([first.status, commentOf(first.body)]).toMatchObject([200, { open: false, resolved_how: 'acted' }]);
    expect(commentOf(again.body)).toMatchObject({ open: false, resolved_how: 'acted' });
    expect((await listed()).comments).toEqual([]);
    expect((await listed('?open=false')).comments).toMatchObject([{ id, resolved_how: 'acted' }]);
  });
});

describe('a comment over HTTP, refused', () => {
  it('names an address of no form a comment takes, or of another playbook, and text over 4,000 characters', async () => {
    const answers = await Promise.all([
      commentMade('alpha/somewhere'),
      commentMade('playbooks/beta'),
      commentMade(addresses.run, 'x'.repeat(4001)),
    ]);

    expect(answers).toMatchObject([
      { status: 422, body: { errors: [{ pointer: '/address' }] } },
      { status: 422, body: { errors: [{ pointer: '/address' }] } },
      { status: 422, body: { errors: [{ pointer: '/text' }] } },
    ]);
  });

  it('is made or resolved in a retired playbook, and finds no comment the playbook does not hold', async () => {
    const { ofTheAdmin, run } = commented;
    const { id } = await made(addresses.run);
    const missing = await resolved(run, 'acted');
    await ofTheAdmin.call('POST', '/v1/orgs/acme/playbooks/alpha/retire');

    expect([missing.status, (await commentMade(addresses.run)).status, (await resolved(id, 'acted')).status]).toEqual([
      404, 409, 409,
    ]);
    expect((await listed()).comments).toHaveLength(1);
  });
});

const connection = '019a3f10-2b4c-7d5e-8f60-718293a4b5c6';

function orgCommentMade(address: string, anchor?: { readonly x: number; readonly y: number }) {
  const { ofTheReader } = commented;
  return ofTheReader.call('POST', '/v1/orgs/acme/comments', {
    address,
    text: `About ${address}`,
    ...(anchor === undefined ? {} : { anchor }),
  });
}

describe("the organization's comments over HTTP", () => {
  it('are made on its things with an anchor, answering 201 and Settings in Studio, and listed apart from the playbooks', async () => {
    const answer = await orgCommentMade(`org/connections/${connection}`, { x: 0.18, y: 0.5 });
    const { id } = commentOf(answer.body);
    await made(addresses.run);
    const { ofTheAdmin } = commented;
    const ofTheOrg = commentsOf((await ofTheAdmin.call('GET', '/v1/orgs/acme/comments')).body);
    const atConnections: unknown = expect.stringMatching(
      new RegExp(`\\?server=[^&]+&settings=connections&comment=${id}$`, 'u'),
    );

    expect(answer).toMatchObject({
      status: 201,
      body: {
        address: `org/connections/${connection}`,
        anchor: { x: 0.18, y: 0.5 },
        studio: atConnections,
      },
    });
    expect(ofTheOrg.comments.map(({ address }) => address)).toEqual([`org/connections/${connection}`]);
  });

  it('are resolved on the org route, and refused for an address of a playbook', async () => {
    const { ofTheAdmin } = commented;
    const { id } = commentOf((await orgCommentMade('org/settings/billing')).body);
    const resolvedInOrg = await ofTheAdmin.call('POST', `/v1/orgs/acme/comments/${id}/resolve`, { how: 'acted' });

    expect([resolvedInOrg.status, commentOf(resolvedInOrg.body)]).toMatchObject([200, { open: false }]);
    expect(await orgCommentMade(addresses.run)).toMatchObject({
      status: 422,
      body: { errors: [{ pointer: '/address' }] },
    });
  });

  it('are named among the changes of the org, made and resolved', async () => {
    const { ofTheAdmin } = commented;
    const { cursor } = ChangesSchemaOf((await ofTheAdmin.call('GET', '/v1/orgs/acme/changes')).body);
    const { id } = commentOf((await orgCommentMade('org')).body);
    const changed = ChangesSchemaOf((await ofTheAdmin.call('GET', `/v1/orgs/acme/changes?since=${cursor}`)).body);

    expect(changed.changes).toContainEqual({ kind: 'comment', comment_id: id });
  });
});
