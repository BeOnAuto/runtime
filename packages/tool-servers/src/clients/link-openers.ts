import type { FetchOfACall } from '@on.auto/operations';

import { timerOf, type Timing } from '../bounds/call-bounds.ts';
import type { Secrets } from '../bounds/secrets.ts';
import { apiClient, type ApiOpening } from '../openapi/api-client.ts';
import type { LinkedServerSettings } from '../openapi/described-api.ts';
import { openHttp } from './http-client.ts';
import {
  boundedReport,
  errorsNoLongerReported,
  tracedClient,
  type ClientInfo,
  type OutputReport,
  type TraceMeta,
} from './mcp-client.ts';
import type { ServedClient } from './server-client.ts';
import type { StdioOpening } from './stdio-client.ts';
import {
  tokenSource,
  type ConsentTokenSources,
  type Discovery,
  type TokenSource,
  type TokenSourceOptions,
} from './token-source.ts';

export interface LinkOptions {
  readonly clientInfo: ClientInfo;
  readonly fetch: FetchOfACall;
  readonly consent: ConsentTokenSources;
  readonly subjectTokens?: TokenSourceOptions['subjectTokens'];
  readonly secrets: Secrets;
  readonly now: () => number;
  readonly documents?: ApiOpening['documents'];
  readonly timer?: Timer;
  readonly timing: Timing;
  readonly reportOutput: (server: string, line: string) => void;
  readonly reportMarkUnlisted: (server: string, tool: string) => void;
  readonly traceMeta?: TraceMeta;
}

type Timer = ReturnType<typeof timerOf>;

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

function isDiscoveredAtTheIssuer(auth: Remote['settings']['auth']): boolean {
  return auth !== null && auth.grant !== 'token_exchange' && auth.discovery === 'issuer';
}

function orgOf({ orgs }: Pick<LinkedServerSettings, 'orgs'>): string | undefined {
  return orgs?.length === 1 ? orgs[0] : undefined;
}

function sourceOptionsOf({ settings, serverUrl, discovery }: Remote, options: Linking): TokenSourceOptions {
  const { now, secrets, fetch, subjectTokens } = options;
  const server = tokenHolderOf(settings);
  return { server, serverUrl, discovery, fetch, now, minted: secrets.replace, subjectTokens, org: orgOf(settings) };
}

function tokensOf(remote: Remote, options: Linking): TokenSource | undefined {
  const { settings } = remote;
  const { auth } = settings;
  if (auth === null) {
    return undefined;
  }
  if (auth.grant === 'token_exchange') {
    return tokenSource(auth, sourceOptionsOf(remote, options));
  }
  const { credential } = auth;
  const { now, secrets, timer } = options;
  return credential.kind === 'consent'
    ? options.consent.tokenSource(credential, {
        name: settings.name,
        holder: tokenHolderOf(settings),
        now,
        timer,
        hold: secrets.replace,
      })
    : tokenSource({ ...auth, credential }, sourceOptionsOf(remote, options));
}

async function openedStdio(
  settings: Extract<LinkedServerSettings, { readonly type: 'stdio' }>,
  opening: StdioOpening,
): Promise<ServedClient> {
  const { openStdio } = await import('./stdio-client.ts');
  return openStdio(settings, opening);
}

function tracedOpener(open: () => Promise<ServedClient>, traceMeta?: TraceMeta): () => Promise<ServedClient> {
  return traceMeta === undefined ? open : async () => tracedClient(await open(), traceMeta);
}

function linkingOf(linkOptions: LinkOptions): Linking {
  return { ...linkOptions, timer: linkOptions.timer ?? timerOf(linkOptions.timing) };
}

export function tokensOfTheLink(settings: LinkedServerSettings, linkOptions: LinkOptions): TokenSource | undefined {
  const options = linkingOf(linkOptions);
  if (settings.type === 'stdio') {
    return undefined;
  }
  if (settings.type === 'openapi') {
    return tokensOf({ settings, serverUrl: settings.api.baseUrl, discovery: 'from_the_issuer' }, options);
  }
  const discovery = isDiscoveredAtTheIssuer(settings.auth) ? 'from_the_issuer' : 'from_the_server';
  return tokensOf({ settings, serverUrl: settings.url, discovery }, options);
}

export function openerOf(
  settings: LinkedServerSettings,
  linkOptions: LinkOptions,
  tokens = tokensOfTheLink(settings, linkOptions),
): () => Promise<ServedClient> {
  const options = linkingOf(linkOptions);
  const output: OutputReport = {
    scrub: options.secrets.scrub,
    report: (line) => {
      options.reportOutput(settings.name, line);
    },
  };
  if (settings.type === 'stdio') {
    return tracedOpener(
      () =>
        openedStdio(settings, {
          clientInfo: options.clientInfo,
          timeoutMs: options.timing.openMs,
          stopMs: options.timing.stopMs,
          output,
          timer: options.timer,
        }),
      options.traceMeta,
    );
  }
  if (settings.type === 'openapi') {
    return () =>
      Promise.resolve(
        apiClient(settings, { fetch: options.fetch, tokens, now: options.now, documents: options.documents }),
      );
  }
  const { openMs, longestRetryWaitMs } = options.timing;
  return tracedOpener(
    () =>
      openHttp(settings, {
        clientInfo: options.clientInfo,
        fetch: options.fetch,
        authProvider: tokens,
        timeoutMs: openMs,
        longestRetryWaitMs,
        reportError: boundedReport(output, errorsNoLongerReported),
        timer: options.timer,
      }),
    options.traceMeta,
  );
}
