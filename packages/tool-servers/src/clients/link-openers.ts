import type { FetchLike } from '@modelcontextprotocol/client';

import type { Timing } from '../bounds/call-bounds.ts';
import type { Secrets } from '../bounds/secrets.ts';
import { apiClient } from '../openapi/api-client.ts';
import type { DescribedApiSettings, LinkedServerSettings } from '../openapi/described-api.ts';
import { openHttp, systemTimer, type Timer } from './http-client.ts';
import {
  boundedReport,
  errorsNoLongerReported,
  tracedClient,
  type ClientInfo,
  type OutputReport,
  type TraceMeta,
} from './mcp-client.ts';
import type { ServerClient } from './server-client.ts';
import { openStdio } from './stdio-client.ts';
import { tokenSource, type Discovery, type TokenSource } from './token-source.ts';

export interface LinkOptions {
  readonly clientInfo: ClientInfo;
  readonly fetch: FetchLike;
  readonly secrets: Secrets;
  readonly now: () => number;
  readonly timer?: Timer;
  readonly timing: Timing;
  readonly reportOutput: (server: string, line: string) => void;
  readonly traceMeta?: TraceMeta;
}

interface Remote {
  readonly server: string;
  readonly auth: DescribedApiSettings['auth'];
  readonly serverUrl: string;
  readonly discovery: Discovery;
}

function tokensOf({ server, auth, serverUrl, discovery }: Remote, options: LinkOptions): TokenSource | undefined {
  return auth === null
    ? undefined
    : tokenSource(auth, {
        server,
        serverUrl,
        discovery,
        fetch: options.fetch,
        now: options.now,
        minted: options.secrets.replace,
      });
}

function tokenHolderOf({ name, connection }: LinkedServerSettings): string {
  return connection === null ? name : `connection ${connection}`;
}

function tracedOpener(open: () => Promise<ServerClient>, traceMeta?: TraceMeta): () => Promise<ServerClient> {
  return traceMeta === undefined ? open : async () => tracedClient(await open(), traceMeta);
}

export function openerOf(settings: LinkedServerSettings, options: LinkOptions): () => Promise<ServerClient> {
  const output: OutputReport = {
    scrub: options.secrets.scrub,
    report: (line) => {
      options.reportOutput(settings.name, line);
    },
  };
  if (settings.type === 'stdio') {
    return tracedOpener(
      () => openStdio(settings, { clientInfo: options.clientInfo, timeoutMs: options.timing.openMs, output }),
      options.traceMeta,
    );
  }
  if (settings.type === 'openapi') {
    const tokens = tokensOf(
      {
        server: tokenHolderOf(settings),
        auth: settings.auth,
        serverUrl: settings.api.baseUrl,
        discovery: 'from_the_issuer',
      },
      options,
    );
    return () => Promise.resolve(apiClient(settings, { fetch: options.fetch, tokens, now: options.now }));
  }
  const authProvider = tokensOf(
    { server: tokenHolderOf(settings), auth: settings.auth, serverUrl: settings.url, discovery: 'from_the_server' },
    options,
  );
  const { openMs, longestRetryWaitMs } = options.timing;
  return tracedOpener(
    () =>
      openHttp(settings, {
        clientInfo: options.clientInfo,
        fetch: options.fetch,
        authProvider,
        timeoutMs: openMs,
        longestRetryWaitMs,
        reportError: boundedReport(output, errorsNoLongerReported),
        timer: options.timer ?? systemTimer,
      }),
    options.traceMeta,
  );
}
