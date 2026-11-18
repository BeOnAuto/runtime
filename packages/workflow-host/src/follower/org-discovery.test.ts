import { Effect, Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { definitionRecorded, eventTrigger } from '../reaction-testing/playbook-writes.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { followedOrgsOn } from './followed-orgs.ts';
import { orgDiscoveryOn } from './org-discovery.ts';

describe('the orgs the follower places at its start', () => {
  it("are those a workflow's own stream names, never a playbook's stream of the workflows' type or a stream under no key", async () => {
    const opened = await openedOn(await onSQLite());
    const database = {
      ...opened,
      store: {
        ...opened.store,
        definitionStreams: () =>
          Promise.resolve([
            {
              stream: 'playbook/globex/alpha/definitions/workflow',
              version: 1,
              playbookKey: 'playbook/globex/alpha/',
            },
            { stream: 'definitions/workflow', version: 1, playbookKey: 'playbook/globex/alpha/' },
          ]),
      },
    };
    const orgs = followedOrgsOn(opened);
    const discovery = orgDiscoveryOn({
      database,
      orgs,
      placeAtOpen: ['0'],
      applyDefinitionRecord: () => Effect.die(new Error('No record is applied here')),
      unreadable: Function.constant(Effect.void),
      definitionType: 'workflow',
    });

    await Effect.runPromise(discovery.atStart());

    expect(await Effect.runPromise(orgs.load('globex'))).toBeUndefined();
  });
});

describe('a record of a workflow the follower cannot read as it places the org at its start', () => {
  it('is said, with the playbook the workflow is in, and its org placed all the same', async () => {
    const opened = await openedOn(await onSQLite());
    await definitionRecorded(opened.store, {
      name: 'watch',
      version: 1,
      triggers: [eventTrigger({ type: 'com.acme.sentinel' })],
    });
    const { through } = await opened.store.readAppended(undefined, 0);
    const unread: string[] = [];
    const orgs = followedOrgsOn(opened);
    const discovery = orgDiscoveryOn({
      database: opened,
      orgs,
      placeAtOpen: through,
      applyDefinitionRecord: () => Effect.succeed('unreadable'),
      unreadable: (playbookKey, { type }) =>
        Effect.sync(() => {
          unread.push(`${playbookKey} ${type}`);
        }),
      definitionType: 'workflow',
    });

    await Effect.runPromise(discovery.atStart());

    expect(unread).toEqual(['playbook/acme/alpha/ definition_created']);
    expect((await Effect.runPromise(orgs.load('acme')))?.org).toBe('acme');
  });
});
