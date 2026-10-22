import { Function } from 'effect';

import { release } from '../composition/release.ts';
import type { Install, StartPing, UsagePing } from '../server-options/server-options.ts';
import type { LedgerSettings } from '../settings/ledger-settings.ts';
import { installIdFileOf, installIn } from './install-id.ts';
import type { UsagePingSettings } from './usage-ping-settings.ts';

export type PingFetch = (url: string, init: { readonly signal: AbortSignal }) => Promise<Response>;

interface RunningNode {
  readonly platform: string;
  readonly arch: string;
  readonly versions: { readonly node: string };
}

export interface UsagePingHost {
  readonly fetch: PingFetch;
  readonly runtimeHome: string;
  readonly running: RunningNode;
}

interface Pinging {
  readonly host: UsagePingHost;
  readonly settings: UsagePingSettings;
  readonly ledger: LedgerSettings;
  readonly deadlineMs: number;
}

const startPingEndpoint = 'https://get.on.auto/runtime/start';

const usagePingDocumentation = 'https://on.auto/docs/self-host/configuration#usage-ping';

export const firstStartNotice = `Auto Runtime sends an anonymous usage ping when it starts. To turn it off, set DO_NOT_TRACK=1 or USAGE_PING=false. ${usagePingDocumentation}`;

const giveUpAfterMs = 3000;

function startPingUrlOf(
  { platform, arch, versions }: RunningNode,
  { distribution }: UsagePingSettings,
  install: Install | undefined,
): string {
  const query = new URLSearchParams([
    ['version', release.version],
    ['platform', platform],
    ['arch', arch],
    ['node', versions.node],
    ['distribution', distribution],
    ...(install === undefined ? [] : [['install', install.id]]),
  ]);
  return `${startPingEndpoint}?${query.toString()}`;
}

function pinged(fetch: PingFetch, url: string, signal: AbortSignal): Promise<void> {
  return Promise.try(fetch, url, { signal })
    .then((response) => response.body?.cancel())
    .then(Function.constVoid, Function.constVoid);
}

function startPingOf({ host, settings, ledger, deadlineMs }: Pinging): StartPing {
  const stopping = new AbortController();
  let install: Install | undefined;
  return {
    installId: () => install?.id,
    sent: () => {
      install = installIn(installIdFileOf(ledger, host.runtimeHome));
      const deadline = AbortSignal.any([AbortSignal.timeout(deadlineMs), stopping.signal]);
      void pinged(host.fetch, startPingUrlOf(host.running, settings, install), deadline);
      return install;
    },
    stop: () => {
      stopping.abort();
    },
  };
}

export function usagePingOf(host: UsagePingHost, deadlineMs = giveUpAfterMs): UsagePing {
  return ({ usagePing, ledger }) =>
    usagePing === undefined ? undefined : startPingOf({ host, settings: usagePing, ledger, deadlineMs });
}
