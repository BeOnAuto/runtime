import type { CallerIdentity } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { adminsAlone, startedByAdminsOf, startsNotSaid, startsUnread } from '../testing/connection-starts.ts';
import { ada, grace, recordedAs } from '../testing/harness.ts';
import {
  changesSince,
  connectedAs,
  linkOf,
  pressed,
  pressingWith,
  revocationsAt,
  standingOf,
} from '../testing/presses.ts';

const linus: CallerIdentity = { ...ada, id: 'person:linus', name: 'Linus Torvalds' };

const graceAlone = () => startedByAdminsOf('messages', [grace.id]);

const adaAndGrace = () => startedByAdminsOf('messages', [ada.id, grace.id]);

describe('Connect again, where only an admin connects the provider that replaces the one it was made from', () => {
  it('is pressed by an admin who did not add it, and the connection added again under its name is finished through its link', async () => {
    const pressing = await pressingWith(graceAlone().starts);
    const before = (await pressing.h.facts()).length;

    const outcome = await pressed(pressing, pressing.old.id, grace);
    const moved = linkOf(outcome);

    expect(outcome).toMatchObject({
      status: 'succeeded',
      output: { name: 'files', provider: 'messages', status: 'pending', added_by: recordedAs.grace },
    });
    expect(await changesSince(pressing.h, before)).toEqual([
      ['connection_removed', pressing.old.id],
      ['connection_added', moved.id],
      ['connection_link_issued', moved.id],
    ]);
    expect(await connectedAs(pressing, moved, grace)).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', connected_by: recordedAs.grace, entry: { playbooks: ['sales'] } },
    });
  });

  it('is refused to the person who added it where they are no admin, in the host’s words, before anything changes', async () => {
    const pressing = await pressingWith(graceAlone().starts);
    const before = await standingOf(pressing);

    expect(await pressed(pressing, pressing.old.id, ada)).toMatchObject({ reason: 'forbidden', detail: adminsAlone });
    expect(await standingOf(pressing)).toEqual(before);
  });
});

describe('Connect again pressed by two admins at once', () => {
  it('adds the connection again once, the other press refused with nothing more changed', async () => {
    const pressing = await pressingWith(adaAndGrace().starts);
    const before = (await pressing.h.facts()).length;

    const outcomes = await Promise.all([
      pressed(pressing, pressing.old.id, ada),
      pressed(pressing, pressing.old.id, grace),
    ]);

    expect(outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'succeeded' }),
        expect.objectContaining({ status: 'rejected', reason: 'conflict' }),
      ]),
    );
    expect((await changesSince(pressing.h, before)).map(([type]) => type)).toEqual([
      'connection_removed',
      'connection_added',
      'connection_link_issued',
    ]);
    expect(revocationsAt(pressing)).toBe(1);
  });
});

describe('a connection an admin connected again and left waiting', () => {
  it('is given a new link by the admin who pressed, at any time', async () => {
    const pressing = await pressingWith(adaAndGrace().starts);
    const left = linkOf(await pressed(pressing, pressing.old.id, ada));

    expect(await pressed(pressing, left.id, ada)).toMatchObject({
      status: 'succeeded',
      output: { id: left.id, added_by: recordedAs.ada },
    });
  });

  it('is given a new link by another admin, the same connection under its name and for its playbooks, which they then finish', async () => {
    const pressing = await pressingWith(adaAndGrace().starts);
    const left = linkOf(await pressed(pressing, pressing.old.id, ada));
    const before = (await pressing.h.facts()).length;

    const relinked = await pressed(pressing, left.id, grace);
    const newer = linkOf(relinked);

    expect(relinked).toMatchObject({ output: { id: left.id, status: 'pending', added_by: recordedAs.ada } });
    expect(await changesSince(pressing.h, before)).toEqual([['connection_link_issued', left.id]]);
    expect(await connectedAs(pressing, newer, grace)).toMatchObject({
      output: { status: 'connected', connected_by: recordedAs.grace, entry: { playbooks: ['sales'] } },
    });
  });

  it('once connected by the admin who pressed it, is given a new link by another admin, as any connection is', async () => {
    const pressing = await pressingWith(adaAndGrace().starts);
    const pressedByAda = linkOf(await pressed(pressing, pressing.old.id, ada));
    await connectedAs(pressing, pressedByAda, ada);
    const before = (await pressing.h.facts()).length;

    expect(await pressed(pressing, pressedByAda.id, grace)).toMatchObject({
      status: 'succeeded',
      output: { id: pressedByAda.id, status: 'connected' },
    });
    expect(await changesSince(pressing.h, before)).toEqual([['connection_link_issued', pressedByAda.id]]);
  });
});

describe('Connect again, refused to whoever is no person of the org, before the host is asked', () => {
  it('is not pressed by a key, a person of another org or a playbook acting as itself', async () => {
    const heard = graceAlone();
    const pressing = await pressingWith(heard.starts);
    const before = await standingOf(pressing);
    const callers: readonly CallerIdentity[] = [
      { ...grace, id: 'acme-builder', name: 'acme-builder' },
      { ...grace, org: 'globex' },
      { ...grace, id: 'playbook:sales', name: 'sales' },
    ];

    const outcomes = await Promise.all(callers.map((caller) => pressed(pressing, pressing.old.id, caller)));

    expect(outcomes.map(({ status }) => status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(heard.asked()).toEqual([]);
    expect(await standingOf(pressing)).toEqual(before);
  });

  it('is refused to a person the host counts no admin of the org, a member or not, changing nothing', async () => {
    const heard = graceAlone();
    const pressing = await pressingWith(heard.starts);
    const before = await standingOf(pressing);

    expect(await pressed(pressing, pressing.old.id, linus)).toMatchObject({ reason: 'forbidden', detail: adminsAlone });
    expect(heard.asked()).toEqual([['messages', linus.id]]);
    expect(await standingOf(pressing)).toEqual(before);
  });

  it('is refused unavailable, changing nothing, where the host cannot say whether the caller is an admin', async () => {
    const pressing = await pressingWith(startsNotSaid);
    const before = await standingOf(pressing);

    expect(await pressed(pressing, pressing.old.id, grace)).toMatchObject({
      reason: 'unavailable',
      detail: startsUnread,
    });
    expect(await standingOf(pressing)).toEqual(before);
  });
});

describe('Connect again, where whoever may add a connection connects the provider that replaces its own', () => {
  it('is pressed by a person who did not add it, and the connection added again under its name is theirs', async () => {
    const pressing = await pressingWith(startedByAdminsOf('drive', [grace.id]).starts);

    expect(await pressed(pressing, pressing.old.id, grace)).toMatchObject({
      output: { provider: 'messages', added_by: recordedAs.grace },
    });
  });

  it('gives a connection someone else left waiting a new link, the same connection', async () => {
    const pressing = await pressingWith(startedByAdminsOf('drive', [grace.id]).starts);
    const left = linkOf(await pressed(pressing, pressing.old.id, ada));

    expect(await pressed(pressing, left.id, grace)).toMatchObject({
      status: 'succeeded',
      output: { id: left.id, added_by: recordedAs.ada },
    });
  });
});
