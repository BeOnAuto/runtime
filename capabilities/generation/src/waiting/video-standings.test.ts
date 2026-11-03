import { describe, expect, it } from 'vitest';

import { generationBounds } from '../capability/generation-ports.ts';
import {
  answeringAfter,
  contentAnswering,
  failedWith,
  flying,
  rejectionIn,
  runIn,
  spent,
  waitingRowIn,
} from '../run-testing/waiting-runs.ts';
import { answeredInTime, filmedBytes, harnessStartsAt, type GenerationHarness } from '../testing/index.ts';

const firstPoll = harnessStartsAt + 5000;

async function polledOnce(playbook: GenerationHarness) {
  await playbook.pollAt(firstPoll);
  const row = await waitingRowIn(playbook);
  return { polls: row.polls, next: row.next_poll_at, run: (await runIn(playbook)).status };
}

const askedAgain = { polls: 1, next: harnessStartsAt + 15_000, run: 'started' };

function failingOnce(): () => Response {
  const answers = { content: 0 };
  return () => {
    answers.content += 1;
    return answers.content === 1 ? new Response(null, { status: 502 }) : new Response(filmedBytes);
  };
}

describe('a video the provider fails to make', () => {
  it('ends the run unavailable in the words of its error code, with what it cost', async () => {
    const playbook = await flying(answeredInTime({ standings: [failedWith('internal_error')] }));

    await playbook.pollAt(firstPoll);

    expect(await runIn(playbook)).toMatchObject({
      status: 'rejected',
      rejection: {
        reason: 'unavailable',
        detail:
          'The provider behind the gateway gateway could not make the video, with the error code internal_error; try again',
      },
      record: spent,
    });
  });

  it('ends the run as blocked by moderation where its error says so', async () => {
    const playbook = await flying(answeredInTime({ standings: [failedWith('moderation_blocked')] }));

    await playbook.pollAt(firstPoll);

    expect(await runIn(playbook)).toMatchObject({
      rejection: { reason: 'conflict', kind: 'blocked_by_moderation' },
      record: spent,
    });
  });
});

describe('a gateway that cannot say how a video stands', () => {
  it('is asked again later where it is busy, and the run goes on waiting', async () => {
    const playbook = await flying(answeringAfter(1, () => new Response(null, { status: 503 })));

    expect(await polledOnce(playbook)).toEqual(askedAgain);
  });

  it('is asked again later where its answer is garbled', async () => {
    const playbook = await flying(answeringAfter(1, () => new Response('not json')));

    expect(await polledOnce(playbook)).toEqual(askedAgain);
  });

  it('is asked again later where it cannot be reached', async () => {
    const playbook = await flying(answeringAfter(1, () => Promise.reject(new Error('The gateway is not reachable'))));

    expect(await polledOnce(playbook)).toEqual(askedAgain);
  });

  it('ends the run unavailable where the gateway no longer knows the video', async () => {
    const playbook = await flying(answeringAfter(1, () => Response.json({ error: { code: 'nope' } }, { status: 404 })));

    await playbook.pollAt(firstPoll);

    expect(await rejectionIn(playbook)).toBe(
      'The gateway gateway no longer knows the video it was making; a new run asks for it again',
    );
  });

  it('ends the run as the gateway refuses where it refuses to say', async () => {
    const playbook = await flying(
      answeringAfter(1, () => Response.json({ error: { code: 'invalid_video_id' } }, { status: 400 })),
    );

    await playbook.pollAt(firstPoll);

    expect(await runIn(playbook)).toMatchObject({
      rejection: { reason: 'conflict', kind: 'unworkable' },
      record: spent,
    });
  });
});

describe('the bytes of a video', () => {
  it('end the run unavailable where they are no video', async () => {
    const playbook = await flying(
      contentAnswering(() => new Response('<html>', { headers: { 'content-type': 'text/html' } })),
    );

    await playbook.pollAt(firstPoll);

    expect(await rejectionIn(playbook)).toBe('The gateway gateway answered as text/html, which is no video; try again');
  });

  it('end the run as oversized where they are larger than the runtime keeps of one video, keeping nothing', async () => {
    const playbook = await flying(
      contentAnswering(() => new Response(filmedBytes)),
      {
        bounds: { ...generationBounds, mostBytes: { ...generationBounds.mostBytes, video: 4 } },
      },
    );

    await playbook.pollAt(firstPoll);

    expect(await runIn(playbook)).toMatchObject({
      rejection: {
        reason: 'conflict',
        kind: 'oversized',
        detail: 'The video the model made is larger than the 4 bytes this runtime keeps of one video',
      },
      record: spent,
    });
    expect(await playbook.totals()).toEqual({ bytes: 0, assets: 0 });
  });

  it('are asked for again at the next poll where the gateway could not answer them, and are taken as video/mp4 where it names no type', async () => {
    const playbook = await flying(contentAnswering(failingOnce()));

    const between = await polledOnce(playbook);
    await playbook.pollAt(harnessStartsAt + 15_000);

    expect(between).toEqual(askedAgain);
    expect(await runIn(playbook)).toMatchObject({ status: 'succeeded', output: { media_type: 'video/mp4' } });
  });
});

describe('the bytes of a video the gateway refuses', () => {
  it('end the run unavailable, naming the error code, where the gateway refuses them', async () => {
    const playbook = await flying(
      contentAnswering(() => Response.json({ error: { code: 'video_not_ready', message: 'no' } }, { status: 400 })),
    );

    await playbook.pollAt(firstPoll);

    expect(await runIn(playbook)).toMatchObject({
      rejection: {
        reason: 'unavailable',
        detail:
          'The gateway gateway refused the bytes of the video it made (HTTP 400), with the error code video_not_ready; a new run asks for it again',
      },
      record: spent,
    });
  });

  it('end the run as blocked by moderation where the gateway refuses them under it', async () => {
    const playbook = await flying(
      contentAnswering(() => Response.json({ error: { code: 'content_policy_violation' } }, { status: 400 })),
    );

    await playbook.pollAt(firstPoll);

    expect(await runIn(playbook)).toMatchObject({ rejection: { reason: 'conflict', kind: 'blocked_by_moderation' } });
  });
});
