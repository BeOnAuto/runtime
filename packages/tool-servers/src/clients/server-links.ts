import { markedTool, unlistedMarksOf } from '../listing/tool-marks.ts';
import type { LinkedServerSettings } from '../openapi/described-api.ts';
import { ignored } from './ignored.ts';
import { openerOf, type LinkOptions } from './link-openers.ts';
import type { ServedClient, ServerClient } from './server-client.ts';
import { ConnectionBroken, failureOf } from './server-failures.ts';

export type CredentialRefused = (answered: string) => Promise<string>;

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

async function brokenOrAsIs(refused: CredentialRefused, error: unknown): Promise<unknown> {
  const { kind, message } = failureOf(error);
  return kind === 'key_refused' ? new ConnectionBroken(await refused(message)) : error;
}

async function failedOnceTold(refused: CredentialRefused, error: unknown): Promise<never> {
  throw await brokenOrAsIs(refused, error);
}

function tellingRefusals(client: ServerClient, refused: CredentialRefused): ServerClient {
  return {
    ...client,
    call: async (calling) => {
      const settled = await client.call(calling);
      return 'error' in settled ? { ...settled, error: await brokenOrAsIs(refused, settled.error) } : settled;
    },
    listTools: (timeoutMs) => client.listTools(timeoutMs).catch((error: unknown) => failedOnceTold(refused, error)),
  };
}

type MarkUnlisted = LinkOptions['reportMarkUnlisted'];

function markedClient(client: ServedClient, settings: LinkedServerSettings, unlisted: MarkUnlisted): ServerClient {
  return {
    ...client,
    listTools: async (timeoutMs) => {
      const tools = await client.listTools(timeoutMs);
      for (const tool of unlistedMarksOf(tools, settings)) {
        unlisted(settings.name, tool);
      }
      return tools.map((tool) => markedTool(tool, settings));
    },
  };
}

function markingListings(
  open: () => Promise<ServedClient>,
  settings: LinkedServerSettings,
  unlisted: MarkUnlisted,
): () => Promise<ServerClient> {
  return async () => markedClient(await open(), settings, unlisted);
}

function refusalsTold(open: () => Promise<ServerClient>, refused?: CredentialRefused): () => Promise<ServerClient> {
  return refused === undefined
    ? open
    : () =>
        open().then(
          (client) => tellingRefusals(client, refused),
          (error: unknown) => failedOnceTold(refused, error),
        );
}

export function serverLink(
  settings: LinkedServerSettings,
  options: LinkOptions,
  credentialRefused?: CredentialRefused,
): ServerLink {
  const marking = markingListings(openerOf(settings, options), settings, options.reportMarkUnlisted);
  const held = heldClient(refusalsTold(marking, credentialRefused));
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
