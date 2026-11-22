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

const readingTheRoomsName = { tool: 'room_info', with: { room: '{{ subject }}' }, named: '/room/title', prefix: '#' };

const aPostsType = {
  type: postedInARoom,
  title: 'A message is posted',
  subject: { title: 'Room', required: true },
  data: { type: 'object', properties: { text: { type: 'string' } } },
};

const reportingPosts = {
  types: [aPostsType],
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

/** The events the rooms entry reports, its posts' room named through `room_info` where it says how to read the name. */
function reportingPostsOf(namesTheRoom: boolean) {
  return namesTheRoom
    ? { ...reportingPosts, types: [{ ...aPostsType, subject: { ...aPostsType.subject, name: readingTheRoomsName } }] }
    : reportingPosts;
}

/** The rooms entry shipped beside the runtime's own, since only an entry the runtime ships declares events. */
function shippedWithRoomsAt(url: string, namesTheRoom: boolean): (files: ShippedFiles) => ShippedFiles {
  const beside = shippedFileIn(entries, 'rooms.yaml').path;
  const entry = JSON.stringify({ ...entryOf('rooms', url, signedOverTheBody), events: reportingPostsOf(namesTheRoom) });
  const isTheEntry = (file: ShippedFile) => file.package === entries.package && file.path === beside;
  const isTheEntries = (folder: ShippedFile) => folder.package === entries.package && folder.path === entries.path;
  return (files) => ({
    text: (file) => (isTheEntry(file) ? Promise.resolve(entry) : files.text(file)),
    bytes: (file) => files.bytes(file),
    list: async (folder) => (isTheEntries(folder) ? [...(await files.list(folder)), 'rooms.yaml'] : files.list(folder)),
  });
}

const listening = { type: postedInARoom, source: '/connections/rooms', subject: theRoom };

export const listeningWorkflow = 'on-a-post';

const listeningSource = workflowSource(
  listeningWorkflow,
  `schedule:\n  on: { one: { with: ${JSON.stringify(listening)} } }\ndo:\n  - noted: { set: { seen: true } }\n`,
);

/** A workflow whose trigger names the rooms connection, saved through the API as a person's agent saves one. */
async function savedThroughTheApi({ server }: ListeningInTheRoom, org: string): Promise<void> {
  await server.call('POST', `/v1/orgs/${org}/playbooks/alpha/definitions/workflow`, {
    body: { name: listeningWorkflow, source: listeningSource },
  });
}

/**
 * The same workflow saved through the ledger, as the intake's own tests save one, since the API refuses a trigger whose
 * event the runtime does not hear, as a runtime that nothing outside can reach does not hear a room's posts.
 */
function savedOnTheLedger({ ledger }: ListeningInTheRoom, org: string): Promise<void> {
  const ada = { id: 'person:ada', name: 'Ada' };
  const filters = [{ reference: '/schedule/on/one', type: postedInARoom, attributes: listening }];
  const created = {
    type: 'create',
    name: listeningWorkflow,
    content: { source: listeningSource, triggers: [{ kind: 'event', reference: '/schedule/on', filters }] },
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
export interface ListeningInTheRoom {
  readonly server: InteractionServer;
  readonly ledger: Ledger['Service'];
}

interface Listening {
  readonly org: string;
  readonly namesTheRoom: boolean;
  readonly saved: (served: ListeningInTheRoom, org: string) => Promise<void>;
}

async function servedListening(
  roomsUrl: string,
  environment: Readonly<Record<string, string>>,
  parts: ServedParts,
  { org, namesTheRoom, saved }: Listening,
): Promise<ListeningInTheRoom> {
  const kept = Promise.withResolvers<Ledger['Service']>();
  const ledgerOver = (ledger: Ledger['Service']) => {
    kept.resolve(ledger);
    return ledger;
  };
  const shipped = { ...parts, ledgerOver, shippedFilesOver: shippedWithRoomsAt(roomsUrl, namesTheRoom) };
  const server = await servingInteractions(roomsDelivery, { ...connectionsOnLoopback, ...environment }, shipped, org);
  await connectedWith(server, { provider: 'rooms' }, roomsKey, connectionsIn(org));
  const served = { server, ledger: await kept.promise };
  await saved(served, org);
  return served;
}

export async function servedListeningInTheRoom(
  roomsUrl: string,
  environment: Readonly<Record<string, string>>,
  parts: ServedParts,
  org: string,
): Promise<InteractionServer> {
  return (await servedListening(roomsUrl, environment, parts, { org, namesTheRoom: false, saved: savedThroughTheApi }))
    .server;
}

/**
 * The same server, whose rooms entry also says how to read the name of a room, through `room_info`, and the ledger it
 * keeps, which the org's connections are read from.
 */
export function servedNamingTheRoom(
  roomsUrl: string,
  environment: Readonly<Record<string, string>>,
  parts: ServedParts,
  org: string,
): Promise<ListeningInTheRoom> {
  return servedListening(roomsUrl, environment, parts, { org, namesTheRoom: true, saved: savedOnTheLedger });
}
