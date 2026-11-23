import { defaultOrg } from '@on.auto/openid-connect';
import { describe, expect, it } from 'vitest';

import { servingInteractions } from '../testing/interaction-servers/interaction-server.ts';
import {
  listingRoomsServer,
  roomsDelivery,
  roomsKey,
  theRoom,
  type ListedPost,
} from '../testing/interaction-servers/room-events.ts';
import { aSecretHeader, connectedWith, connectionsIn } from '../testing/servers/connected-servers.ts';
import { connectionsOnLoopback } from '../testing/servers/loopback-connections.ts';
import { workflowSource } from '../testing/servers/workflow-server.ts';
import { firstCheckSwept, runsStartedByChecks } from '../testing/webhooks/swept-hooks.ts';

const alpha = `/v1/orgs/${defaultOrg}/playbooks/alpha`;

const listingTheRoom = {
  tool: 'list_posts',
  with: { room: theRoom, after: '{{ since }}' },
  list: '/posts',
  order: 'oldest_first',
  cursor: '/at',
  id: ['/id'],
  time: '/at',
};

const readingTheRoom = { with: { type: 'post.listed', source: '/connections/notes' }, read: listingTheRoom };

const readingWorkflow = 'on-a-listed-post';

const steps = `schedule:\n  on: { one: ${JSON.stringify(readingTheRoom)} }\ndo:\n  - noted: { set: { seen: true } }\n`;

describe('a self-hosted runtime whose workflow’s trigger names a tool of a connection added by hand for Auto to check', () => {
  it('saves the trigger, checks the tool, starts one run for a post listed after its first check, and shows the trigger at the pace of its checks', async () => {
    const posts: ListedPost[] = [];
    const rooms = await listingRoomsServer(posts);
    const server = await servingInteractions(roomsDelivery, connectionsOnLoopback, {}, defaultOrg);
    await connectedWith(server, aSecretHeader('notes', rooms.url), `Bearer ${roomsKey}`, connectionsIn(defaultOrg));

    const saved = await server.call('POST', `${alpha}/definitions/workflow`, {
      body: { name: readingWorkflow, source: workflowSource(readingWorkflow, steps) },
    });
    await firstCheckSwept(server, rooms);
    posts.push({ room: theRoom, id: 'p-1', text: 'hi', at: new Date(server.runsOn.now()).toISOString() });
    const started = await runsStartedByChecks(server, alpha);
    const workflow = await server.call('GET', `${alpha}/definitions/workflow/${readingWorkflow}`);

    expect(saved.status).toBe(201);
    expect(started).toBe(1);
    expect(workflow).toMatchObject({
      status: 200,
      body: {
        standing: {
          triggers: [{ connection: 'notes', speed: 'polling', polling_interval_seconds: 60, listening: true }],
        },
      },
    });
  });
});
