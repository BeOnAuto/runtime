import { readPageStyle, type AppRuntime, type CallContext, type RegisterRoutes } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';
import { Effect } from 'effect';

import { runtimeLedger } from '../../composition/runtime-ledger.ts';
import { incidentsLoggedIn } from '../../logging/logging.ts';
import type { Settings } from '../../settings/settings.ts';
import { inProcessDirectory } from '../turn/in-process-directory.ts';
import { chatOpenedFor, type ChatOpened, type ChatOpening } from './chat-knowing.ts';
import { chatComposedOf, type ChatComposed, type ChatComposing } from './chat-served.ts';
import { connectionsOverTheLedger } from './ledger-ports.ts';

type ChatThrough = Parameters<typeof chatComposedOf>[1];

interface WorkflowsServed {
  readonly routes: readonly RegisterRoutes[];
  readonly stopWork: () => Promise<void>;
  readonly callContext: CallContext;
}

interface RemovedConnection {
  readonly connection: string;
  readonly account: string | undefined;
}

const chatWords = {
  unforgotten:
    'What members wrote through a removed connection could not be deleted, and stays. admin delete-chat deletes it by member or by conversation, not by connection',
} as const;

type Runtime = AppRuntime<DispatcherServices>;

type ShippedFiles = Parameters<typeof readPageStyle>[0];

export interface ChatAtStart {
  readonly publicUrl: string;
  readonly links: ChatOpened['store']['links'];
  readonly connectionRemoved: (removed: RemovedConnection) => Effect.Effect<void>;
  readonly names: ChatComposed['names'];
  readonly over: (
    runtime: Runtime,
    models: Pick<ChatComposing, 'models' | 'modelChoice' | 'callAsTheConnection'>,
  ) => (through: ChatThrough) => ChatComposed['sockets'];
  readonly answering: <Served extends WorkflowsServed>(
    runtime: Runtime,
    served: Served,
    files: ShippedFiles,
  ) => Promise<Served>;
}

function connectionRemovedFrom({ store }: ChatOpened) {
  return (removed: RemovedConnection): Effect.Effect<void> =>
    Effect.tryPromise(() => store.deletions.connectionRemoved(removed)).pipe(
      Effect.catch(() => Effect.logWarning(chatWords.unforgotten)),
      Effect.annotateLogs({ connection: removed.connection }),
    );
}

export function chatAtStartOf(opened: ChatOpened, settings: Pick<Settings, 'providers' | 'studio'>): ChatAtStart {
  const directory = inProcessDirectory();
  const composed: { latest: ChatComposed | undefined } = { latest: undefined };
  const names: ChatComposed['names'] = {
    ofTheService: (account) => composed.latest?.names.ofTheService(account) ?? Effect.runPromise(Effect.undefined),
    ofTheMember: (member) => composed.latest?.names.ofTheMember(member) ?? Effect.runPromise(Effect.undefined),
  };
  return {
    names,
    publicUrl: opened.publicUrl,
    links: opened.store.links,
    connectionRemoved: connectionRemovedFrom(opened),
    over: (runtime: Runtime, models: Pick<ChatComposing, 'models' | 'modelChoice' | 'callAsTheConnection'>) => {
      const connections = connectionsOverTheLedger(runtimeLedger(runtime), settings.providers);
      return (through: ChatThrough) => {
        composed.latest = chatComposedOf(
          {
            opened,
            ...connections,
            ...models,
            directory,
            context: runtime.context,
          },
          through,
        );
        return composed.latest.sockets;
      };
    },
    answering: async <Served extends WorkflowsServed>(runtime: Runtime, served: Served, files: ShippedFiles) => {
      const inProcess = directory.composed({
        allowedOrigins: [],
        studio: { ...settings.studio, served: false },
        routes: served.routes,
        reportIncident: incidentsLoggedIn(runtime),
        pageStyle: await readPageStyle(files),
        callContext: served.callContext,
      });
      const stopWork = async () => {
        await served.stopWork();
        await inProcess.close();
      };
      return { ...served, stopWork };
    },
  };
}

export async function chatAtStartOpened(opening: ChatOpening, settings: Pick<Settings, 'providers' | 'studio'>) {
  const opened = await chatOpenedFor(opening);
  return opened === undefined ? undefined : chatAtStartOf(opened, settings);
}
