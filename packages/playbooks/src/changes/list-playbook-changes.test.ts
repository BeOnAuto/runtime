import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { changesOf, followedPlaybook, listPlaybookChanges } from '../testing/followed-changes.ts';

const atOnce = { wait: '0' };

const saysToStartAgain: unknown = expect.stringContaining('ask again without since');

describe('list_playbook_changes', () => {
  it('is a query of the playbook at GET /changes, over HTTP alone, that may refuse its input', () => {
    expect(listPlaybookChanges.registration).toMatchObject({
      scope: 'playbook',
      kind: 'query',
      name: 'list_playbook_changes',
      route: { method: 'GET', path: '/changes' },
      reasons: ['invalid_input'],
      servedOverHttpAlone: { kind: 'none' },
    });
  });

  it('answers the cursor of now and no changes without since, and from it what changed after, each resource once in order', async () => {
    const followed = followedPlaybook();
    await followed.run(followed.runRecorded('r0'));

    const now = changesOf(await followed.changes());
    await followed.recording('notes', 'added', 'a note');
    await followed.run(
      Effect.all([followed.runRecorded('r2'), followed.runRecorded('r1'), followed.runRecorded('r2')]),
    );
    await followed.run(followed.runRecorded('r3', 'hidden'));
    const after = changesOf(await followed.changes({ since: now.cursor, ...atOnce }));
    const again = changesOf(await followed.changes({ since: after.cursor, ...atOnce }));

    expect([now.changes, now.more]).toEqual([[], false]);
    expect(after).toMatchObject({
      changes: [
        { kind: 'run', run_id: 'r2' },
        { kind: 'run', run_id: 'r1' },
      ],
      more: false,
    });
    expect(again).toEqual({ cursor: after.cursor, changes: [], more: false });
  });
});

describe('list_playbook_changes, while nothing changed', () => {
  it('holds the request until the next change, and through facts that name nothing', async () => {
    const followed = followedPlaybook();
    const now = changesOf(await followed.changes());

    const held = await followed.heldWhile(
      { since: now.cursor },
      Effect.andThen(followed.waited(3), followed.runRecorded('r1', 'hidden')).pipe(
        Effect.andThen(followed.waited(3)),
        Effect.andThen(followed.runRecorded('r2')),
      ),
    );

    expect(changesOf(held)).toMatchObject({ changes: [{ kind: 'run', run_id: 'r2' }], more: false });
  });

  it('answers no changes once the wait passes, giving back the cursor it was given past facts that named nothing', async () => {
    const followed = followedPlaybook();
    const now = changesOf(await followed.changes());

    const held = changesOf(
      await followed.heldWhile(
        { since: now.cursor, wait: '5' },
        Effect.andThen(followed.runRecorded('r1', 'hidden'), followed.waited(5)),
      ),
    );
    const after = changesOf(await followed.changes({ since: held.cursor, ...atOnce }));

    expect(held).toEqual({ cursor: now.cursor, changes: [], more: false });
    expect(after).toEqual({ cursor: now.cursor, changes: [], more: false });
  });
});

describe('list_playbook_changes, when much changed', () => {
  it('lists at most 200 resources, says more changed, and goes on from the last it listed', async () => {
    const followed = followedPlaybook();
    const now = changesOf(await followed.changes());
    await followed.run(
      Effect.forEach(
        Array.from({ length: 201 }, (_, run) => `r${run}`),
        (run) => followed.runRecorded(run),
      ),
    );

    const first = changesOf(await followed.changes({ since: now.cursor, ...atOnce }));
    const next = changesOf(await followed.changes({ since: first.cursor, ...atOnce }));

    expect([first.changes.length, first.more, first.changes.at(-1)]).toEqual([
      200,
      true,
      { kind: 'run', run_id: 'r199' },
    ]);
    expect([next.changes, next.more]).toEqual([[{ kind: 'run', run_id: 'r200' }], false]);
  });

  it('lists every resource a fact names, once, and leaves a fact whose resources pass the 200 to the next answer', async () => {
    const followed = followedPlaybook();
    const now = changesOf(await followed.changes());
    await followed.run(
      Effect.forEach(
        Array.from({ length: 199 }, (_, run) => `r${run}`),
        (run) => followed.runRecorded(run),
      ),
    );
    await followed.recording('pairs/p1', 'added', 'paired');

    const first = changesOf(await followed.changes({ since: now.cursor, ...atOnce }));
    const next = changesOf(await followed.changes({ since: first.cursor, ...atOnce }));

    expect([first.changes.length, first.more]).toEqual([199, true]);
    expect(next).toMatchObject({
      changes: [
        { kind: 'run', run_id: 'p1' },
        { kind: 'pair', pair: 'p1' },
      ],
      more: false,
    });
  });
});

describe('list_playbook_changes, when one read holds more than it lists', () => {
  it('says more followed when it read as many facts as it reads at once, though they named fewer resources', async () => {
    const followed = followedPlaybook();
    const now = changesOf(await followed.changes());
    await followed.run(Effect.forEach(Array.from({ length: 1001 }), () => followed.runRecorded('r1')));

    const first = changesOf(await followed.changes({ since: now.cursor, ...atOnce }));
    const next = changesOf(await followed.changes({ since: first.cursor, ...atOnce }));

    expect([first.changes, first.more]).toEqual([[{ kind: 'run', run_id: 'r1' }], true]);
    expect([next.changes, next.more]).toEqual([[{ kind: 'run', run_id: 'r1' }], false]);
  });
});

describe('list_playbook_changes, given what it cannot take', () => {
  it('refuses a cursor it does not hold, saying to start without since, and a wait past 25 seconds', async () => {
    const followed = followedPlaybook();

    const [unheld, tooLong, negative] = await Promise.all([
      followed.changes({ since: 'not a cursor' }),
      followed.changes({ wait: '26' }),
      followed.changes({ wait: '-1' }),
    ]);

    expect(unheld).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      kind: 'cursor_not_held',
      detail: saysToStartAgain,
      issues: [{ pointer: '/since' }],
    });
    expect([tooLong, negative]).toMatchObject([
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/wait' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/wait' }] },
    ]);
  });
});
