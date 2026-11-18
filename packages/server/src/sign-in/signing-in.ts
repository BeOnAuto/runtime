import type { Environment } from '@on.auto/config';
import type { FakeProviderOptions } from '@on.auto/openid-connect/testing';
import { onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { rowsOfTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { providerOverHttps } from './issuer-over-https.ts';

export const subject = 'AItOawmwtWwcT0k51BayewNvutrJUqsvl6qs7A4';

interface Asking {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

type FakeProvider = Awaited<ReturnType<typeof providerOverHttps>>;

export interface SigningIn {
  readonly provider: FakeProvider;
  readonly address: string;
  readonly environment: Environment;
  readonly at: (path: string, init?: Asking) => Promise<Response>;
  readonly sessionsKept: () => Promise<readonly unknown[]>;
  readonly peopleKept: () => Promise<readonly unknown[]>;
}

export interface SigningInAs {
  readonly provider?: FakeProviderOptions;
  readonly settings?: Environment;
  readonly registered?: boolean;
}

function environmentOf(provider: FakeProvider, port: number, registered: boolean): Environment {
  const client = registered ? {} : { OIDC_CLIENT_ID: provider.clientId, OIDC_CLIENT_SECRET: provider.clientSecret };
  return {
    HOST: '127.0.0.1',
    PORT: String(port),
    PUBLIC_URL: `http://localhost:${port}`,
    OIDC_ISSUER: provider.issuer,
    ...client,
  };
}

type RunningServer = Awaited<ReturnType<typeof startServer>>;

export interface Running extends SigningIn {
  readonly server: () => RunningServer;
  readonly restarted: () => Promise<RunningServer>;
}

export async function signingIn({
  provider: options = {},
  settings = {},
  registered = false,
}: SigningInAs = {}): Promise<Running> {
  const provider = await providerOverHttps('/tenant/v2.0', options);
  const port = await aPortNothingListensOn();
  const ledger = temporaryLedger();
  const environment = { ...environmentOf(provider, port, registered), ...settings, LEDGER_FILE: ledger.fileName };
  const running = { server: await startServer(environment, compositionRoot) };
  onTestFinished(async () => {
    await running.server.stop();
    ledger.remove();
  });
  return {
    provider,
    address: `http://localhost:${port}`,
    environment,
    at: (path, init = {}) => fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual', ...init }),
    sessionsKept: () => rowsOfTheLedgerIn(ledger.fileName, 'auth_sessions'),
    peopleKept: () => rowsOfTheLedgerIn(ledger.fileName, 'auth_people'),
    server: () => running.server,
    restarted: async () => {
      await running.server.stop();
      running.server = await startServer(environment, compositionRoot);
      return running.server;
    },
  };
}

export async function startOf(options: FakeProviderOptions, registered: boolean): Promise<unknown> {
  const provider = await providerOverHttps('/tenant/v2.0', options);
  const port = await aPortNothingListensOn();
  const ledger = temporaryLedger();
  onTestFinished(() => {
    ledger.remove();
  });
  const environment = { ...environmentOf(provider, port, registered), LEDGER_FILE: ledger.fileName };
  return startServer(environment, compositionRoot).catch((failure: unknown) => failure);
}

export function cookiesOf(answer: Readonly<Response>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    answer.headers.getSetCookie().map((cookie) => {
      const [pair = '', ...attributes] = cookie.split('; ');
      const [name = '', value = ''] = pair.split('=');
      const kept = attributes.filter((attribute) => !attribute.startsWith('Expires='));
      return [name, [value === '' ? 'ended' : 'set', ...kept.toSorted()].join('; ')];
    }),
  );
}

export function cookieValueOf(answer: Readonly<Response>, name: string): string {
  const named = answer.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
  return String(named?.split(';')[0]);
}

export async function callbackFor(
  { provider, at }: Pick<SigningIn, 'provider' | 'at'>,
  who: string,
  idToken: Readonly<Record<string, unknown>> = {},
  cookie = '',
): Promise<Response> {
  const begun = await at('/auth/oidc');
  const pending = cookieValueOf(begun, '__Host-sign-in');
  return at(`/auth/oidc/callback?${provider.signedIn(String(begun.headers.get('location')), who, idToken)}`, {
    headers: { cookie: [pending, cookie].filter((value) => value !== '').join('; ') },
  });
}
