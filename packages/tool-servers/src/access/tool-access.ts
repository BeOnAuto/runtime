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

export interface LinkedOptions extends ToolAccessOptions, RecordingParts {
  readonly reportLeftOut: Describing['reportLeftOut'];
}

async function linked(settings: ToolServers, options: LinkedOptions): Promise<LinkedAccess> {
  const { linkedAccess } = await import('./linked-access.ts');
  return linkedAccess(settings, options);
}

export function makeToolAccess(settings: ToolServers, options: ToolAccessOptions): ToolAccess {
  const loading: { access?: Promise<LinkedAccess> } = {};
  const recording = recordingPartsOf(settings.servers, options.content, options.runtimeSecrets ?? []);
  const source = options.connections ?? noConnections;
  const linkedOnUse = (): Promise<LinkedAccess> => {
    loading.access ??= linked(settings, { ...options, ...recording, reportLeftOut: options.reportLeftOut ?? ignored });
    return loading.access;
  };
  const access = orgAccessOf(settings, { source, loaded: linkedOnUse, secrets: recording.secrets });
  return {
    configured: settings.servers.length > 0 || source.takesConnections,
    takesConnections: source.takesConnections,
    ...runWaysOf(access, recording, options.timing),
    ...listingWaysOf(access),
    close: async () => {
      await access.close();
      const loaded = await loading.access;
      await loaded?.close();
    },
  };
}
