import type { ConnectionWays } from '@on.auto/tool-servers';
import type { Context } from 'effect';

import type { ChatServing } from '../arrivals/arrival-parts.ts';
import { chatSocketsOf } from '../arrivals/chat-sockets.ts';
import { ChatConnections, type ChatThrough, type ConnectionsComposing } from './chat-connections.ts';
import { knowingOf, type ChatOpened } from './chat-knowing.ts';
import { namesOf } from './chat-names.ts';
import { turnModelsOf, wallClockWaits, type ModelsOfTheServer } from './turn-models.ts';

export interface ChatComposing extends ConnectionsComposing, ModelsOfTheServer, ConnectionWays {
  readonly opened: ChatOpened;
  readonly directory: ChatServing['directory'];
  readonly context: Context.Context<never> | undefined;
  readonly now?: ChatServing['now'];
  readonly waits?: ChatServing['waits'];
}

export interface ChatComposed {
  readonly sockets: ReturnType<typeof chatSocketsOf>;
  readonly names: ReturnType<typeof namesOf>;
}

export function chatComposedOf(composing: ChatComposing, through: ChatThrough): ChatComposed {
  const now = composing.now ?? Date.now;
  const connections = new ChatConnections(composing, {
    callAsTheConnection: composing.callAsTheConnection,
    mostRequestBytesTo: through.tools.mostRequestBytesTo,
  });
  const serving: ChatServing = {
    store: composing.opened.store,
    knowing: knowingOf(composing.opened, now),
    models: turnModelsOf(composing),
    directory: composing.directory,
    directoryUrl: `${composing.opened.publicUrl}/directory`,
    now,
    waits: composing.waits ?? wallClockWaits,
  };
  const parts = { serving, connectionOf: connections.connectionOf };
  const sockets = composing.context === undefined ? chatSocketsOf(parts) : chatSocketsOf(parts, composing.context);
  return { sockets, names: namesOf(connections) };
}
