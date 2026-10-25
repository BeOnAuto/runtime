import { ignored } from '../clients/ignored.ts';
import type { LinkOptions } from '../clients/link-openers.ts';
import { listingWaysOf, type ListingWays } from '../listing/listing-ways.ts';
import type { Describing, ToolServers } from '../openapi/described-api.ts';
import { noConnections, type ConnectionSource } from '../org-servers/connection-source.ts';
import { orgAccessOf } from '../org-servers/org-access.ts';
import type { ServerMessage } from './caller-context.ts';
import { recordingPartsOf, type ContentStore, type RecordingParts, type SecretValues } from './entry-reads.ts';
import type { LinkedAccess } from './linked-access.ts';
import { runWaysOf, type RunWays } from './run-ways.ts';

export interface ToolAccessOptions {
  readonly clientInfo: LinkOptions['clientInfo'];
  readonly consent: LinkOptions['consent'];
  readonly content: ContentStore;
  readonly reportServerMessage: (report: ServerMessage) => void;
  readonly runtimeSecrets?: SecretValues;
  readonly connections?: ConnectionSource;
  readonly reportLeftOut?: Describing['reportLeftOut'];
  readonly fetch?: LinkOptions['fetch'];
  readonly now?: () => number;
  readonly timing?: LinkOptions['timing'];
  readonly traceMeta?: LinkOptions['traceMeta'];
}

export interface ToolAccess extends RunWays, ListingWays {
  readonly configured: boolean;
  readonly takesConnections: boolean;
  readonly close: () => Promise<void>;
}

type Links = LinkedAccess['fileLinks'];

type LinksLent = () => Promise<Links>;

export interface LinkedOptions extends ToolAccessOptions, RecordingParts {
  readonly reportLeftOut: Describing['reportLeftOut'];
  readonly borrowed: Links;
}

interface LendingAccess extends ToolAccess {
  readonly linksSendingNoRequest: LinksLent;
}

const nothingLent: LinksLent = () => Promise.resolve(new Map());

async function linked(
  settings: ToolServers,
  options: Omit<LinkedOptions, 'borrowed'>,
  lent: LinksLent,
): Promise<LinkedAccess> {
  const [{ linkedAccess }, borrowed] = await Promise.all([import('./linked-access.ts'), lent()]);
  return linkedAccess(settings, { ...options, borrowed });
}

function sendingNoRequest(links: Links): Links {
  const local = [...links.values()].filter((link) => link.settings.type === 'stdio');
  return new Map(local.map((link) => [link.settings.name, link]));
}

export function toolAccessOf(settings: ToolServers, options: ToolAccessOptions, lent = nothingLent): LendingAccess {
  const loading: { access?: Promise<LinkedAccess> } = {};
  const recording = recordingPartsOf(settings.servers, options.content, options.runtimeSecrets ?? []);
  const source = options.connections ?? noConnections;
  const linkedOnUse = (): Promise<LinkedAccess> => {
    const reportLeftOut = options.reportLeftOut ?? ignored;
    loading.access ??= linked(settings, { ...options, ...recording, reportLeftOut }, lent);
    return loading.access;
  };
  const access = orgAccessOf(settings, { source, loaded: linkedOnUse, secrets: recording.secrets });
  return {
    configured: settings.servers.length > 0 || source.takesConnections,
    takesConnections: source.takesConnections,
    ...runWaysOf(access, recording, options.timing),
    ...listingWaysOf(access),
    linksSendingNoRequest: async () => sendingNoRequest((await linkedOnUse()).fileLinks),
    close: async () => {
      await access.close();
      const loaded = await loading.access;
      await loaded?.close();
    },
  };
}
