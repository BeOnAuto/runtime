import { describe, expect, it } from 'vitest';

import { serviceFake, steppedWaits } from '../../testing/chat/chat-fakes.ts';
import type { ChatService } from '../service/service-calls.ts';
import { STATUS_RENEWAL_MS, statusShownFor } from './working-status.ts';

const where = { id: 'm1', conversation: 'c1', thread: undefined, sender: 'u1', kind: 'mention' };

function nowhere(already = false) {
  const kept = { refused: already };
  return {
    notShownHere: {
      has: () => kept.refused,
      add: () => {
        kept.refused = true;
      },
    },
    renewalFailed: () => {},
    kept,
  };
}

describe('the working status of a turn', () => {
  it('is shown at the start, shown again each renewal while the turn runs, and stops with the answer', async () => {
    const { service, calls } = serviceFake();
    const stepped = steppedWaits();
    const status = await statusShownFor(where, { service, working: 'w', waits: stepped.waits, ...nowhere() });
    await stepped.elapse();
    await stepped.elapse();
    await status.answered('the answer');

    expect([calls(), stepped.asked().every((ms) => ms === STATUS_RENEWAL_MS), stepped.stopped()]).toEqual([
      ['typing', 'typing', 'typing', 'answered'],
      true,
      1,
    ]);
  });

  it('renews on the period it is given, and asks nothing after the answer', async () => {
    const { service, calls } = serviceFake();
    const stepped = steppedWaits();
    const status = await statusShownFor(where, {
      service,
      working: 'w',
      waits: stepped.waits,
      renewalMs: 5,
      ...nowhere(),
    });
    await status.answered('done');
    await stepped.elapse();

    expect([stepped.asked(), calls()]).toEqual([[], ['typing', 'answered']]);
  });
});

function renewalsThatFail(service: ChatService, calls: () => readonly string[]) {
  const defect = new Error('a defect');
  const failing: ChatService = {
    ...service,
    typing: (place) => (calls().length === 0 ? service.typing(place) : Promise.reject(defect)),
  };
  return { failing, defect };
}

describe('the working status of a turn, where a renewal fails', () => {
  it('is logged, asked for no more, and the answer is posted all the same', async () => {
    const { service, calls } = serviceFake();
    const stepped = steppedWaits();
    const { failing, defect } = renewalsThatFail(service, calls);
    const failures: unknown[] = [];
    const status = await statusShownFor(where, {
      service: failing,
      working: 'w',
      waits: stepped.waits,
      ...nowhere(),
      renewalFailed: (cause) => {
        failures.push(cause);
      },
    });
    await stepped.elapse();
    await stepped.elapse();
    await status.answered('done');

    expect([calls(), stepped.asked(), failures]).toEqual([['typing', 'answered'], [], [defect]]);
  });
});

describe('the working status of a turn, where the service shows none', () => {
  it.each([
    ['the service shows none here', 'refused', true],
    ['the service failed to show it', 'failed', false],
  ] as const)('is a working message turned into the answer where %s', async (_, typing, remembered) => {
    const { service, calls } = serviceFake({ typing, sent: 'w1' });
    const place = nowhere();
    const status = await statusShownFor(where, { service, working: 'w', waits: steppedWaits().waits, ...place });
    await status.answered('done');

    expect([calls(), place.kept.refused]).toEqual([['typing', 'answered', 'replaced'], remembered]);
  });

  it('is not asked for again where the service showed none, and the answer is posted anew where it cannot replace', async () => {
    const { service, said } = serviceFake({ replaces: false, sent: 'w1' });
    const status = await statusShownFor(where, {
      service,
      working: 'w',
      waits: steppedWaits().waits,
      ...nowhere(true),
    });
    await status.answered('done');

    expect(said.map(({ call, text }) => [call, text])).toEqual([
      ['answered', 'w'],
      ['replaced', 'done'],
      ['answered', 'done'],
    ]);
  });

  it('posts the answer anew where the working message got no id', async () => {
    const { service, calls } = serviceFake({ typing: 'refused' });
    const status = await statusShownFor(where, { service, working: 'w', waits: steppedWaits().waits, ...nowhere() });
    await status.answered('done');

    expect(calls()).toEqual(['typing', 'answered', 'answered']);
  });
});
