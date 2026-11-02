import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { madePlaybook, tallySource, type ActivityPlaybook } from './activity-playbook.ts';
import { activityOf, addressesOf } from './activity-reads.ts';

let server: ReasoningServer;

let alpha: ActivityPlaybook;

const read = async (query = '') => activityOf((await alpha.call('GET', `/v1/orgs/local/activity${query}`)).body);

beforeEach(async () => {
  server = await servingReasoning([]);
  alpha = await madePlaybook(server, 'local');
});

afterEach(async () => {
  await server.stop();
});

async function asked() {
  const dana = await alpha.ran('interaction', 'approve-brief', { owner: 'dana@example.com', campaign: 'Spring' });
  const anyone = await alpha.ran('interaction', 'approve-brief', { owner: 'ada', campaign: 'Spring' });
  const workflow = await alpha.ran('workflow', 'approval', {});
  const open = await alpha.openRequests(3);
  return { dana, anyone, workflow, step: open.find((runId) => runId !== dana && runId !== anyone) ?? '' };
}

describe('the activity of the org over HTTP, for the local developer', () => {
  it('lists the requests, steps included, the broken definition and the versions and playbook saved, all the developer own', async () => {
    await alpha.refused('computation', 'tally', { fail: true });
    const { dana, anyone, step } = await asked();
    const activity = await read();

    expect(
      Object.fromEntries(
        activity.rows
          .filter(({ kind }) => kind === 'needs_you')
          .map(({ address, waits_on: waitsOn }) => [address, waitsOn]),
      ),
    ).toEqual({
      [`alpha/${dana}`]: 'dana@example.com',
      [`alpha/${anyone}`]: 'any_member',
      [`alpha/${step}`]: 'any_member',
    });
    expect(addressesOf(activity, 'broken')).toEqual(['alpha/computation/tally']);
    expect(addressesOf(activity, 'new')).toEqual([
      'alpha/definitions/workflow/approval/1',
      'alpha/definitions/computation/tally/1',
      'alpha/definitions/interaction/approve-brief/1',
      expect.stringMatching(/^playbooks\/alpha\/\d+$/u),
    ]);
    expect(activity.rows.filter(({ kind }) => kind === 'new').map(({ seen }) => seen)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it('counts every open request as waiting on the local developer, whatever address the read gives, and none of their own work as new', async () => {
    await alpha.refused('computation', 'tally', { fail: true });
    await asked();

    expect((await read()).counts).toEqual({ needs_you: 3, broken: 1, new: 0 });
    expect((await read('?address=dana%40example.com')).counts).toEqual({ needs_you: 3, broken: 1, new: 0 });
  });
});

describe('the runs of a workflow in the activity of the org over HTTP', () => {
  it('lists the run of a workflow once it succeeds, and nothing of its steps but the request they made', async () => {
    const { workflow, step } = await asked();
    await alpha.call('POST', `${alpha.playbook}/runs/${step}/answer`, { answer: { choice: 'approve' } });
    await alpha.settled(workflow);
    const activity = await read();

    expect(addressesOf(activity, 'new')).toContain(`alpha/runs/${workflow}`);
    expect(addressesOf(activity, 'new')).not.toContain(`alpha/runs/${step}`);
    expect(addressesOf(activity, 'needs_you')).not.toContain(`alpha/${step}`);
    expect(activity.counts.needs_you).toBe(2);
  });
});

describe('a broken definition in the activity of the org over HTTP', () => {
  it('lists a broken definition until a run of it succeeds, or until a new version is saved', async () => {
    await alpha.refused('computation', 'tally', { fail: true });
    const broken = await read('?kind=broken');
    await alpha.settled(await alpha.ran('computation', 'tally', { fail: false }));
    const succeeded = await read('?kind=broken');
    await alpha.refused('computation', 'tally', { fail: true });
    const brokeAgain = await read('?kind=broken');
    await alpha.call('PUT', `${alpha.playbook}/definitions/computation/tally`, {
      source: tallySource('second'),
      diagram: 'none',
    });
    const saved = await read();

    expect(broken.rows.map(({ address, status }) => [address, status])).toEqual([
      ['alpha/computation/tally', 'rejected'],
    ]);
    expect(succeeded.rows).toEqual([]);
    expect(brokeAgain.counts.broken).toBe(1);
    expect(addressesOf(saved, 'broken')).toEqual([]);
    expect(addressesOf(saved, 'new').slice(0, 2)).toEqual([
      'alpha/definitions/computation/tally/2',
      expect.stringMatching(/^alpha\/runs\//u),
    ]);
  });
});
