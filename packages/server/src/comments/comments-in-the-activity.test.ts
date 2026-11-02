import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { activityOf, seenOf } from '../activity/activity-reads.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import {
  addressesOn,
  commentKeys,
  commentOf,
  commentedPlaybook,
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

async function made(address: string, text = `About ${address}`) {
  const { ofTheReader } = commented;
  return commentOf((await ofTheReader.call('POST', `${ofTheReader.playbook}/comments`, { address, text })).body);
}

const CountsSchema = Schema.Struct({ counts: Schema.Struct({ comments: Schema.Int }) });

async function commentsCountedFor(playbook: CommentedPlaybook['ofTheAdmin']) {
  return Schema.decodeUnknownSync(CountsSchema)((await playbook.call('GET', '/v1/orgs/acme/activity')).body).counts
    .comments;
}

describe('the comments in the activity of the org, over HTTP', () => {
  it('are rows of their own to the other callers, naming what each is about, and counted until seen or resolved', async () => {
    const { ofTheAdmin, ofTheReader, run } = commented;
    const onTheStep = await made(addresses.step, 'Flag it.\nAnd say why.');
    const onTheBlock = await made(addresses.block);
    const read = await ofTheAdmin.call('GET', '/v1/orgs/acme/activity?kind=comment');
    const { rows } = activityOf(read.body);
    const before = [await commentsCountedFor(ofTheAdmin), await commentsCountedFor(ofTheReader)];
    const marked = seenOf(
      (
        await ofTheAdmin.call('POST', '/v1/orgs/acme/activity/seen', {
          items: rows
            .filter(({ address }) => address.endsWith(onTheStep.id))
            .map(({ address, at }) => ({ address, at })),
        })
      ).body,
    );
    await ofTheAdmin.call('POST', `${ofTheAdmin.playbook}/comments/${onTheBlock.id}/resolve`, { how: 'dismissed' });

    expect(read.body).toMatchObject({
      rows: [
        { kind: 'comment', address: `alpha/comments/${onTheBlock.id}`, about: addresses.block, run_id: run },
        {
          kind: 'comment',
          address: `alpha/comments/${onTheStep.id}`,
          by: 'acme-reader',
          by_name: 'acme-reader',
          about: addresses.step,
          message: 'Flag it.',
          definition: { type: 'workflow', name: 'approval', version: 1 },
          run_id: null,
          seen: false,
        },
      ],
    });
    expect(before).toEqual([2, 0]);
    expect(marked.counts).toMatchObject({ comments: 1 });
    expect(await commentsCountedFor(ofTheAdmin)).toBe(0);
    expect(activityOf((await ofTheAdmin.call('GET', '/v1/orgs/acme/activity?kind=comment')).body).rows).toHaveLength(1);
  });
});

const ChangesSchema = Schema.Struct({ cursor: Schema.String });

describe('the changes of a playbook, over HTTP', () => {
  it('name a comment made or resolved, by its id', async () => {
    const { ofTheAdmin } = commented;
    const changes = `${ofTheAdmin.playbook}/changes`;
    const { cursor } = Schema.decodeUnknownSync(ChangesSchema)((await ofTheAdmin.call('GET', changes)).body);
    const { id } = await made(addresses.playbook);
    const afterMade = await ofTheAdmin.call('GET', `${changes}?since=${cursor}&wait=0`);
    const { cursor: next } = Schema.decodeUnknownSync(ChangesSchema)(afterMade.body);
    await ofTheAdmin.call('POST', `${ofTheAdmin.playbook}/comments/${id}/resolve`, { how: 'acted' });

    expect(afterMade.body).toMatchObject({ changes: [{ kind: 'comment', comment_id: id }], more: false });
    expect((await ofTheAdmin.call('GET', `${changes}?since=${next}&wait=0`)).body).toMatchObject({
      changes: [{ kind: 'comment', comment_id: id }],
    });
  });
});
