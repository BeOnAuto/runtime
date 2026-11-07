import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { activityPlaybookOn, madePlaybook, type ActivityPlaybook } from './activity-playbook.ts';
import { activityOf, seenOf } from './activity-reads.ts';

const admin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['playbook:read'], playbooks: '*' });

let server: ReasoningServer;

let ofTheReader: ActivityPlaybook;

let tallied = '';

const read = async (query = '') => activityOf((await ofTheReader.call('GET', `/v1/orgs/acme/activity${query}`)).body);

const marked = async (body: unknown) =>
  seenOf((await ofTheReader.call('POST', '/v1/orgs/acme/activity/seen', body)).body);

beforeEach(async () => {
  server = await servingReasoning([], { API_KEYS: JSON.stringify([admin.entry, reader.entry]) });
  const alpha = await madePlaybook(server, 'acme', admin.key);
  ofTheReader = activityPlaybookOn(server, 'acme', reader.key);
  tallied = await alpha.ran('computation', 'tally', { fail: false });
  await alpha.settled(tallied);
  await alpha.ran('interaction', 'approve-brief', { owner: 'dana@example.com', campaign: 'Spring' });
  await alpha.ran('interaction', 'approve-brief', { owner: 'ada', campaign: 'Spring' });
  await alpha.openRequests(2);
});

afterEach(async () => {
  await server.stop();
});

describe('what a caller has seen of the activity of the org, over HTTP', () => {
  it('shows what others did as new, and counts a request for any member as waiting on the caller, and not one an address names', async () => {
    const activity = await read();

    expect(activity.rows.filter(({ kind }) => kind === 'new').map(({ seen }) => seen)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(activity.rows.filter(({ kind }) => kind === 'needs_you')).toHaveLength(2);
    expect(activity.counts).toEqual({ needs_you: 1, broken: 0, new: 5, comments: 0 });
    expect(activity.through).toBeNull();
  });

  it('marks an item seen, and everything through a cursor, for the caller alone', async () => {
    const { rows } = await read();
    const ranAt = rows.filter(({ address }) => address === `alpha/runs/${tallied}`).map(({ at }) => at);
    const [newest] = rows.map(({ cursor }) => cursor);
    const itemMarked = await marked({ items: ranAt.map((at) => ({ address: `alpha/runs/${tallied}`, at })) });
    const afterItem = await read('?kind=new');
    const throughMarked = await marked({ through: newest });

    expect(ranAt).toHaveLength(1);
    expect(itemMarked).toEqual({ counts: { needs_you: 1, broken: 0, new: 4, comments: 0 }, through: null });
    expect(afterItem.rows.filter(({ seen }) => seen === true).map(({ address }) => address)).toEqual([
      `alpha/runs/${tallied}`,
    ]);
    expect(throughMarked).toMatchObject({
      counts: { needs_you: 1, broken: 0, new: 0, comments: 0 },
      through: { cursor: newest },
    });
    expect((await read()).rows.filter(({ seen }) => seen === false)).toEqual([]);
  });
});
