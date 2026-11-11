import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { FollowedPlaybooks, HeldPlaybook, HeldPlaybooks, Hold } from '../follower/followed-playbooks.ts';
import { holdsKnownIn } from './known-holds.ts';

const now = Date.parse('2026-11-11T09:00:00.000Z');

const hold: Hold = { heldFor: 'content', since: now, until: now + 1000, holds: 1 };

function playbooksAnswering(answers: readonly HeldPlaybooks[]) {
  const asked = { reads: 0 };
  const playbooks: FollowedPlaybooks = {
    follow: () => Effect.void,
    load: () => Effect.die(new Error('The test loads no playbook')),
    save: () => Effect.void,
    held: () => Effect.void,
    lifted: () => Effect.void,
    heldAt: () =>
      Effect.sync(() => {
        asked.reads += 1;
        return answers[asked.reads - 1] ?? { due: [], nextAt: null };
      }),
    waitingForASweep: () => Effect.succeed([]),
    following: () => Effect.succeed([]),
  };
  return { playbooks: holdsKnownIn(playbooks), reads: () => asked.reads };
}

describe('the holds a follower knows of', () => {
  it('are read once, and not again while none is held, until the follower holds a playbook', async () => {
    const { playbooks, reads } = playbooksAnswering([
      { due: [], nextAt: null },
      { due: [], nextAt: now + 1000 },
      { due: [], nextAt: null },
    ]);

    const answers = await Effect.runPromise(
      Effect.all([
        playbooks.heldAt(now, 8),
        playbooks.heldAt(now, 8),
        Effect.andThen(playbooks.held('playbook/acme/alpha/', hold), playbooks.heldAt(now, 8)),
        playbooks.heldAt(now, 8),
        playbooks.heldAt(now, 8),
        playbooks.heldAt(now, 8),
      ]),
    );

    expect(answers.map(({ nextAt }) => nextAt)).toEqual([null, null, now + 1000, null, null, null]);
    expect(reads()).toEqual(3);
  });

  it('are read at every wake while one is due', async () => {
    const alpha: HeldPlaybook = {
      playbookKey: 'playbook/acme/alpha/',
      cursor: null,
      delivered: null,
      attempts: 0,
      waiting: true,
      hold,
    };
    const { playbooks, reads } = playbooksAnswering([
      { due: [alpha], nextAt: null },
      { due: [alpha], nextAt: null },
    ]);

    await Effect.runPromise(Effect.all([playbooks.heldAt(now, 8), playbooks.heldAt(now, 8), playbooks.heldAt(now, 8)]));

    expect(reads()).toEqual(3);
  });
});
