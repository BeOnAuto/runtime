import { SignInNeedsAListener, startServer, startServerInProcess } from '../../lifecycle/lifecycle.ts';
import type { ComposedServerOptions } from '../../server-options/composed-options.ts';
import { temporaryLedger, type TemporaryLedger } from '../records/temporary-ledger.ts';
import { noConsentThroughAuto } from '../settings/no-consent-through-auto.ts';
import type { Answering } from './http-client.ts';
import { answeredAt, asSentTo, inProcessOrigin } from './in-process-origins.ts';
import type { ServedParts } from './served-parts.ts';

export function loopbackSettingsOver(ledger: TemporaryLedger): Readonly<Record<string, string>> {
  return {
    HOST: '127.0.0.1',
    PORT: '0',
    LEDGER_FILE: ledger.fileName,
    ...noConsentThroughAuto,
  };
}

/** The settings of a server answering in the process: no port bound, and its ledger in memory unless a file is given. */
function inProcessSettingsOver(ledger: TemporaryLedger | undefined): Readonly<Record<string, string>> {
  return { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger?.fileName ?? ':memory:', ...noConsentThroughAuto };
}

export interface StartedServer extends Answering {
  readonly stop: () => Promise<void>;
}

async function startedOverHttp(
  environment: Readonly<Record<string, string>>,
  composed: ComposedServerOptions,
  shared: TemporaryLedger | undefined,
): Promise<StartedServer> {
  const ledger = shared ?? temporaryLedger();
  const own = [ledger].filter((each) => each !== shared);
  const removeOwn = (): void => {
    for (const each of own) {
      each.remove();
    }
  };
  const starting = startServer({ ...loopbackSettingsOver(ledger), ...environment }, composed);
  starting.catch(removeOwn);
  const server = await starting;
  return {
    origin: `http://127.0.0.1:${server.port}`,
    answer: (given) => fetch(given),
    stop: async () => {
      await server.stop();
      removeOwn();
    },
  };
}

async function startedInProcess(
  environment: Readonly<Record<string, string>>,
  composed: ComposedServerOptions,
  shared: TemporaryLedger | undefined,
): Promise<StartedServer> {
  const origin = inProcessOrigin(environment['PORT']);
  const server = await startServerInProcess({ ...inProcessSettingsOver(shared), ...environment }, composed, origin);
  const answer = asSentTo(server.fetch);
  const leave = answeredAt(origin, answer);
  return {
    origin,
    answer,
    stop: async () => {
      leave();
      await server.stop();
    },
  };
}

async function startedInProcessUnlessSigningIn(
  environment: Readonly<Record<string, string>>,
  composed: ComposedServerOptions,
  shared: TemporaryLedger | undefined,
): Promise<StartedServer> {
  try {
    return await startedInProcess(environment, composed, shared);
  } catch (refused) {
    if (refused instanceof SignInNeedsAListener) {
      return startedOverHttp(environment, composed, shared);
    }
    throw refused;
  }
}

/**
 * The server composed as given: in the process by default, on an in-memory ledger unless `shared` names a file; over
 * HTTP with a ledger file where `over` asks for a listener, or where the server signs people in, since its sign-in
 * answers on a listener of its own.
 */
export function startedOver(
  over: ServedParts['over'],
  environment: Readonly<Record<string, string>>,
  composed: ComposedServerOptions,
  shared: TemporaryLedger | undefined,
): Promise<StartedServer> {
  return (over === 'http' ? startedOverHttp : startedInProcessUnlessSigningIn)(environment, composed, shared);
}
