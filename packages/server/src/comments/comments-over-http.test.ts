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
