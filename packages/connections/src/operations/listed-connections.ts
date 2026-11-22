import { Effect, Schema } from 'effect';

import { ConnectionSchema } from '../registry/connection.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { GroupOfMoreSchema, RendersField } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { moreOfferedTo } from './more-asked.ts';
import { reportedEventsFields, reportedEventsOf, type ReportedEvents } from './reported-events.ts';
import { shownConnections } from './shown-connections.ts';

export type Reading = Pick<ConnectionServices, 'secrets' | 'providers' | 'consent' | 'pages' | 'received'>;

export const ListedConnectionSchema = Schema.Struct({
  ...ConnectionSchema.fields,
  renders: RendersField,
  more: Schema.Array(GroupOfMoreSchema).annotate({
    description:
      'The groups of scopes its way names that it does not hold and a client here can ask; empty where there is none',
  }),
  ...reportedEventsFields,
}).annotate({
  identifier: 'ListedConnection',
  description: 'A connection, and what it may still be granted beside what it holds',
});

type Shown = Effect.Success<ReturnType<typeof moreOfferedTo>>[number];

function withTheEventsItReports(connection: Shown, { providers, received }: Reading): Shown & ReportedEvents {
  return { ...connection, ...reportedEventsOf(connection, providers, received) };
}

export const listedOf = Effect.fnUntraced(function* (kept: readonly KeptConnection[], reading: Reading) {
  const listed = yield* moreOfferedTo(yield* shownConnections(reading.secrets, kept), reading);
  return listed.map((connection) => withTheEventsItReports(connection, reading));
});
