import { Effect } from 'effect';

import { secretsOfServer, type Secrets } from '../bounds/secrets.ts';
import type {
  ConnectionServer,
  ConnectionSource,
  ConnectionUnready,
  OrgConnection,
  UnreadyBecause,
} from './connection-source.ts';
import { unreadyServer, type Linked, type OrgServer, type Served } from './org-servers.ts';
import { serverFailed, type Unusable } from './server-refusals.ts';

export type Linking = Linked | { readonly unread: Unusable };

export type LinkConnection = (id: string, server: ConnectionServer) => Promise<Linking>;

type Prepared =
  | { readonly server: ConnectionServer }
  | { readonly unready: ConnectionUnready }
  | { readonly failed: Unusable };

type Keeping = Pick<Secrets, 'keep' | 'scrub'>;

interface Connected {
  readonly id: string;
  readonly settings: Served;
  readonly state: ConnectedState;
}

type Run = <A>(effect: Effect.Effect<A>) => Promise<A>;

type ConnectedState = Extract<OrgConnection['state'], { readonly status: 'connected' }>;

interface HeldInAnOrg {
  readonly servers: Map<string, Promise<Prepared>>;
  readonly links: Map<string, Promise<Linking>>;
}

interface Holding {
  readonly held: HeldInAnOrg;
  readonly link: LinkConnection;
  readonly secrets: Keeping;
  readonly run: Run;
}

export interface ConnectionLinks {
  readonly serversOf: (org: string) => Effect.Effect<readonly OrgServer[]>;
  readonly close: () => Promise<void>;
}

async function stopped(link: Promise<Linking>): Promise<void> {
  const linked = await link;
  if ('link' in linked) {
    await linked.link.stop();
  }
}

function stoppedEach(links: readonly Promise<Linking>[]): Promise<readonly PromiseSettledResult<void>[]> {
  return Promise.allSettled(links.map((link) => stopped(link)));
}

async function letGoUnlessKept<A>(
  held: Map<string, Promise<A>>,
  id: string,
  promise: Promise<A>,
  isKept: (value: A) => boolean,
) {
  if (!isKept(await promise) && held.get(id) === promise) {
    held.delete(id);
  }
}

function keptWhile<A>(held: Map<string, Promise<A>>, id: string, promise: Promise<A>, isKept: (value: A) => boolean) {
  held.set(id, promise);
  void letGoUnlessKept(held, id, promise, isKept);
  return promise;
}

function failedWith(settings: Served, secrets: Keeping): (error: unknown) => Unusable {
  return (error) => {
    const message = error instanceof Error ? error.message : String(error);
    return serverFailed({ settings }, { kind: 'failing', message }, secrets);
  };
}

const preparedAgainAtTheNextUse: ReadonlySet<UnreadyBecause> = new Set(['connection_broken', 'connection_unavailable']);

function isKeptForTheProcess(prepared: Prepared): boolean {
  if ('unready' in prepared) {
    return !preparedAgainAtTheNextUse.has(prepared.unready.because);
  }
  return 'server' in prepared;
}

function isLinkedOrRefused(linking: Linking): boolean {
  return !('unread' in linking);
}

function preparedIn(holding: Holding, { id, settings, state }: Connected): Promise<Prepared> {
  const { held, secrets, run } = holding;
  const preparing = held.servers.get(id);
  if (preparing !== undefined) {
    return preparing;
  }
  const failed = failedWith(settings, secrets);
  const prepared = run(
    Effect.match(state.server, {
      onSuccess: (server): Prepared => {
        secrets.keep(secretsOfServer(server.settings));
        return { server };
      },
      onFailure: (unready): Prepared => ({ unready }),
    }),
  ).catch((error: unknown): Prepared => ({ failed: failed(error) }));
  return keptWhile(held.servers, id, prepared, isKeptForTheProcess);
}

async function linkedOnce(
  holding: Holding,
  { id, settings }: Connected,
  prepared: Promise<Prepared>,
): Promise<Linking> {
  const ready = await prepared;
  if ('server' in ready) {
    const failed = failedWith(settings, holding.secrets);
    return holding.link(id, ready.server).catch((error: unknown) => ({ unread: failed(error) }));
  }
  const refusal = 'unready' in ready ? ready.unready : ready.failed;
  return isKeptForTheProcess(ready) ? { refused: refusal } : { unread: refusal };
}

function linkedOf(linking: Linking): Linked {
  return 'unread' in linking ? { refused: linking.unread } : linking;
}

async function linkedIn(holding: Holding, connected: Connected, prepared: Promise<Prepared>): Promise<Linked> {
  const { links } = holding.held;
  const { id } = connected;
  const linking = links.get(id) ?? keptWhile(links, id, linkedOnce(holding, connected, prepared), isLinkedOrRefused);
  return linkedOf(await linking);
}

function prunedTo(held: HeldInAnOrg, connections: readonly OrgConnection[]) {
  const connected = new Set(connections.filter(({ state }) => state.status === 'connected').map(({ id }) => id));
  const gone = [...new Set([...held.servers.keys(), ...held.links.keys()])].filter((id) => !connected.has(id));
  const stopping = gone.flatMap((id) => {
    const link = held.links.get(id);
    held.servers.delete(id);
    held.links.delete(id);
    return link === undefined ? [] : [link];
  });
  return stoppedEach(stopping);
}

function unreadinessOf(prepared: Prepared): readonly ConnectionUnready[] {
  return 'unready' in prepared ? [prepared.unready] : [];
}

function serverOf(holding: Holding, { id, serving, state }: OrgConnection): OrgServer {
  const settings: Served = { ...serving, connection: id };
  if (state.status === 'unready') {
    return unreadyServer(settings, state.unready);
  }
  const connected: Connected = { id, settings, state };
  let preparing: Promise<Prepared> | undefined;
  const prepared = (): Promise<Prepared> => {
    preparing ??= preparedIn(holding, connected);
    return preparing;
  };
  return {
    settings,
    checked: async () => unreadinessOf(await prepared()),
    linked: () => linkedIn(holding, connected, prepared()),
  };
}

export function connectionLinks(source: ConnectionSource, link: LinkConnection, secrets: Keeping): ConnectionLinks {
  const heldByOrg = new Map<string, HeldInAnOrg>();
  const heldIn = (org: string): HeldInAnOrg => {
    const held = heldByOrg.get(org) ?? { servers: new Map(), links: new Map() };
    heldByOrg.set(org, held);
    return held;
  };
  return {
    serversOf: (org) =>
      Effect.gen(function* () {
        const connections = yield* source.connectionsOf(org);
        const held = heldIn(org);
        yield* Effect.promise(() => prunedTo(held, connections));
        const holding: Holding = { held, link, secrets, run: Effect.runPromiseWith(yield* Effect.context()) };
        return connections.map((connection) => serverOf(holding, connection));
      }),
    close: async () => {
      const links = [...heldByOrg.values()].flatMap((held) => Array.from(held.links.values()));
      heldByOrg.clear();
      await stoppedEach(links);
    },
  };
}
