import type { LinkedServerSettings } from '../openapi/described-api.ts';
import { ignored } from './ignored.ts';
import { openerOf, type LinkOptions } from './link-openers.ts';
import type { ServerClient } from './server-client.ts';

export interface ServerLink {
  readonly settings: LinkedServerSettings;
  readonly take: () => Promise<ServerClient>;
  readonly renew: (failed: ServerClient) => Promise<ServerClient>;
  readonly release: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

function endOf(client: Promise<ServerClient> | undefined): Promise<void> | undefined {
  return client?.then((opened) => opened.end(), ignored);
}

interface HeldClient {
  readonly using: () => Promise<ServerClient>;
  readonly forgotten: () => Promise<ServerClient> | undefined;
  readonly isLatest: (client: ServerClient) => boolean;
}

function heldClient(open: () => Promise<ServerClient>): HeldClient {
  let current: Promise<ServerClient> | undefined;
  let latest: ServerClient | undefined;
  return {
    using: () => {
      current ??= open().then((opened) => {
        latest = opened;
        return opened;
      });
      return current;
    },
    forgotten: () => {
      const forgetting = current;
      current = undefined;
      latest = undefined;
      return forgetting;
    },
    isLatest: (client) => latest === client,
  };
}

async function usedOrForgotten(held: HeldClient): Promise<ServerClient> {
  try {
    return await held.using();
  } catch (failure) {
    void held.forgotten();
    throw failure;
  }
}

export function serverLink(settings: LinkedServerSettings, options: LinkOptions): ServerLink {
  const held = heldClient(openerOf(settings, options));
  let holders = 0;
  return {
    settings,
    take: async () => {
      holders += 1;
      try {
        return await usedOrForgotten(held);
      } catch (failure) {
        holders -= 1;
        throw failure;
      }
    },
    renew: (failed) => {
      if (held.isLatest(failed)) {
        void endOf(held.forgotten());
      }
      return usedOrForgotten(held);
    },
    release: async () => {
      holders -= 1;
      if (holders === 0 && settings.type === 'mcp') {
        await endOf(held.forgotten());
      }
    },
    stop: async () => {
      await endOf(held.forgotten());
    },
  };
}
