import { defaultTiming } from '../bounds/call-bounds.ts';
import { serverLink, type ServerLink } from '../clients/server-links.ts';
import { listedServer } from '../listing/tool-servers.ts';
import { oneCall, type OneCall, type RunCall } from '../one-call/one-call.ts';
import type { ToolServers } from '../openapi/described-api.ts';
import { connectionLinkOf } from '../org-servers/connection-linking.ts';
import type { LinkConnection } from '../org-servers/connection-links.ts';
import type { OrgServer } from '../org-servers/org-servers.ts';
import { openedRun, type Opening } from './run-opening.ts';
import type { LinkedOptions } from './tool-access.ts';

type Opened = Pick<Opening, 'context' | 'references' | 'links'>;

export interface LinkedAccess {
  readonly fileLinks: ReadonlyMap<string, ServerLink>;
  readonly connectionLink: LinkConnection;
  readonly open: (opened: Opened) => ReturnType<typeof openedRun>;
  readonly callOnce: (call: OneCall, server: OrgServer, runCall?: RunCall) => ReturnType<typeof oneCall>;
  readonly listed: (served: OrgServer['settings'], link: ServerLink) => ReturnType<typeof listedServer>;
  readonly close: () => Promise<void>;
}

export function linkedAccess(settings: ToolServers, options: LinkedOptions): LinkedAccess {
  const report = options.reportServerMessage;
  const timing = options.timing ?? defaultTiming;
  const { secrets, keepIn } = options;
  const linkOptions = {
    clientInfo: options.clientInfo,
    fetch: options.fetch ?? globalThis.fetch,
    consent: options.consent,
    secrets,
    now: options.now ?? Date.now,
    timing,
    reportOutput: (server: string, message: string) => {
      report({ server, message, run_id: null, call_id: null });
    },
    ...(options.traceMeta === undefined ? {} : { traceMeta: options.traceMeta }),
  };
  const made = settings.servers.filter(({ name }) => !options.borrowed.has(name));
  const madeLinks = new Map(made.map((server) => [server.name, serverLink(server, linkOptions)]));
  const fileLinks = new Map([...options.borrowed, ...madeLinks]);
  const linking = { options: linkOptions, reportLeftOut: options.reportLeftOut };
  return {
    fileLinks,
    connectionLink: (id, server) => connectionLinkOf(id, server, linking),
    open: (opened) => openedRun({ ...opened, secrets, keepIn, timing, report }),
    callOnce: (call, server, runCall) => oneCall(call, server, { secrets, keepIn, timing }, runCall),
    listed: (served, link) => listedServer(served, link, { secrets, timing }),
    close: async () => {
      await Promise.all([...madeLinks.values()].map((link) => link.stop()));
    },
  };
}
