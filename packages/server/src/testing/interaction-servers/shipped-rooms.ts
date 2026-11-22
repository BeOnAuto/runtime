import { decidedIn } from '@on.auto/definitions/testing';
import type { Ledger } from '@on.auto/operations';
import { shippedFileIn, type ShippedFile, type ShippedFiles } from '@on.auto/shipped-files';
import { Effect } from 'effect';

import { connectedWith, connectionsIn } from '../servers/connected-servers.ts';
import { connectionsOnLoopback } from '../servers/loopback-connections.ts';
import type { ServedParts } from '../servers/served-parts.ts';
import { workflowSource } from '../servers/workflow-server.ts';
import { servingInteractions, type InteractionServer } from './interaction-server.ts';
import { entryOf, roomsDelivery, roomsKey, signedOverTheBody, theRoom } from './room-events.ts';

export const postedInARoom = 'com.example.rooms.message.posted';

const reportingPosts = {
  types: [
    {
      type: postedInARoom,
      title: 'A message is posted',
      subject: { title: 'Room', required: true },
      data: { type: 'object', properties: { text: { type: 'string' } } },
    },
  ],
  identity: { tool: 'who_am_i', identified: { id: '/me/id' } },
  destinations: [
    {
      ...signedOverTheBody,
      events: [
        {
          type: postedInARoom,
          when: { '$request.body#/kind': ['posted'] },
          id: ['$request.body#/room', '$request.body#/id'],
          subject: '$request.body#/room',
          data: { text: '$request.body#/text' },
          actor: '$request.body#/by',
          topic: '{{ subject }}',
        },
      ],
    },
  ],
};

const entries: ShippedFile = { package: '@on.auto/providers', path: 'src/entries' };

/** The rooms entry shipped beside the runtime's own, since only an entry the runtime ships declares events. */
function shippedWithRoomsAt(url: string): (files: ShippedFiles) => ShippedFiles {
  const beside = shippedFileIn(entries, 'rooms.yaml').path;
  const entry = JSON.stringify({ ...entryOf('rooms', url, signedOverTheBody), events: reportingPosts });
  const isTheEntry = (file: ShippedFile) => file.package === entries.package && file.path === beside;
  const isTheEntries = (folder: ShippedFile) => folder.package === entries.package && folder.path === entries.path;
  return (files) => ({
    text: (file) => (isTheEntry(file) ? Promise.resolve(entry) : files.text(file)),
    bytes: (file) => files.bytes(file),
    list: async (folder) => (isTheEntries(folder) ? [...(await files.list(folder)), 'rooms.yaml'] : files.list(folder)),
  });
}

const listening = { type: postedInARoom, source: '/connections/rooms', subject: theRoom };

/**
 * A workflow whose trigger names the rooms connection, saved through the ledger as the intake's own tests save one,
 * since no trigger that names a connection can be saved through the API until a connection lists the events it reports.
 */
function savedListening(ledger: Ledger['Service'], org: string): Promise<void> {
  const ada = { id: 'person:ada', name: 'Ada' };
  const schedule = `schedule:\n  on: { one: { with: ${JSON.stringify(listening)} } }\n`;
  const source = workflowSource('on-a-post', `${schedule}do:\n  - noted: { set: { seen: true } }\n`);
  const filters = [{ reference: '/schedule/on/one', type: postedInARoom, attributes: listening }];
  const created = {
    type: 'create',
    name: 'on-a-post',
    content: { source, triggers: [{ kind: 'event', reference: '/schedule/on', filters }] },
    created_by: ada,
    definition_id: crypto.randomUUID(),
    by: ada.id,
    at: new Date().toISOString(),
  } as const;
  return Effect.runPromise(decidedIn(ledger, { org, playbook: 'alpha' }, 'workflow', created));
}

/**
 * A server whose playbook alpha keeps a workflow listening for the posts in the room of its requests, through a rooms
 * connection whose entry ships with the runtime and declares, as data, the event a delivery of a post is, who posted it,
 * and the tool that answers which account the connection acts as.
 */
export async function servedListeningInTheRoom(
  roomsUrl: string,
  environment: Readonly<Record<string, string>>,
  parts: ServedParts,
  org: string,
): Promise<InteractionServer> {
  const kept = Promise.withResolvers<Ledger['Service']>();
  const ledgerOver = (ledger: Ledger['Service']) => {
    kept.resolve(ledger);
    return ledger;
  };
  const shipped = { ...parts, ledgerOver, shippedFilesOver: shippedWithRoomsAt(roomsUrl) };
  const server = await servingInteractions(roomsDelivery, { ...connectionsOnLoopback, ...environment }, shipped, org);
  await connectedWith(server, { provider: 'rooms' }, roomsKey, connectionsIn(org));
  await savedListening(await kept.promise, org);
  return server;
}
