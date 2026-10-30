import type { FetchLike } from '@modelcontextprotocol/client';

import type { Timing } from '../bounds/call-bounds.ts';
import type { Secrets } from '../bounds/secrets.ts';
import { apiClient, type ApiOpening } from '../openapi/api-client.ts';
import type { LinkedServerSettings } from '../openapi/described-api.ts';
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
import type { StdioOpening } from './stdio-client.ts';
import { tokenSource, type ConsentTokenSources, type Discovery, type TokenSource } from './token-source.ts';

export interface LinkOptions {
  readonly clientInfo: ClientInfo;
  readonly fetch: FetchLike;
  readonly consent: ConsentTokenSources;
  readonly secrets: Secrets;
  readonly now: () => number;
  readonly documents?: ApiOpening['documents'];
  readonly timer?: Timer;
  readonly timing: Timing;
  readonly reportOutput: (server: string, line: string) => void;
  readonly traceMeta?: TraceMeta;
}

interface Remote {
  readonly settings: Extract<LinkedServerSettings, { readonly auth: unknown }>;
  readonly serverUrl: string;
  readonly discovery: Discovery;
}

interface Linking extends LinkOptions {
  readonly timer: Timer;
}

function tokenHolderOf({ name, connection }: LinkedServerSettings): string {
  return connection === null ? name : `connection ${connection}`;
}

function tokensOf({ settings, serverUrl, discovery }: Remote, options: Linking): TokenSource | undefined {
  const { auth } = settings;
  if (auth === null) {
    return undefined;
  }
  const { credential } = auth;
  const holder = tokenHolderOf(settings);
  const { now, secrets, timer } = options;
  return credential.kind === 'consent'
    ? options.consent.tokenSource(credential, { name: settings.name, holder, now, timer, hold: secrets.replace })
    : tokenSource(
        { ...auth, credential },
        { server: holder, serverUrl, discovery, fetch: options.fetch, now, minted: secrets.replace },
      );
}

async function openedStdio(
  settings: Extract<LinkedServerSettings, { readonly type: 'stdio' }>,
  opening: StdioOpening,
): Promise<ServerClient> {
  const { openStdio } = await import('./stdio-client.ts');
  return openStdio(settings, opening);
}

function tracedOpener(open: () => Promise<ServerClient>, traceMeta?: TraceMeta): () => Promise<ServerClient> {
  return traceMeta === undefined ? open : async () => tracedClient(await open(), traceMeta);
}

export function openerOf(settings: LinkedServerSettings, linkOptions: LinkOptions): () => Promise<ServerClient> {
  const options: Linking = { ...linkOptions, timer: linkOptions.timer ?? systemTimer };
  const output: OutputReport = {
    scrub: options.secrets.scrub,
    report: (line) => {
      options.reportOutput(settings.name, line);
    },
  };
  if (settings.type === 'stdio') {
    return tracedOpener(
      () => openedStdio(settings, { clientInfo: options.clientInfo, timeoutMs: options.timing.openMs, output }),
      options.traceMeta,
    );
  }
  if (settings.type === 'openapi') {
    const tokens = tokensOf({ settings, serverUrl: settings.api.baseUrl, discovery: 'from_the_issuer' }, options);
    return () =>
      Promise.resolve(
        apiClient(settings, { fetch: options.fetch, tokens, now: options.now, documents: options.documents }),
      );
  }
  const authProvider = tokensOf({ settings, serverUrl: settings.url, discovery: 'from_the_server' }, options);
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
        timer: options.timer,
      }),
    options.traceMeta,
  );
}
