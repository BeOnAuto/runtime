import { valueAt } from '@on.auto/definitions/tool-blocks';
import type { BearerSending, RequestedOnce } from '@on.auto/tool-servers';
import { Effect, Redacted } from 'effect';

import type { Destination } from '../events/destination-fields.ts';
import {
  SocketEnded,
  type ConstructsASocket,
  type OpensASocket,
  type SendsABearerRequest,
  type SocketOpening,
} from './socket-ports.ts';

export interface OpeningWays {
  readonly sends: SendsABearerRequest;
  readonly sending: Pick<BearerSending, 'fetch' | 'reaches' | 'callMs' | 'mostRequestBytes'>;
  readonly constructs: ConstructsASocket;
}

type Open = NonNullable<Destination['open']>;

type Sending = OpeningWays['sending'];

function notOpenedAt(host?: string): SocketEnded {
  return new SocketEnded(host === undefined ? { end: 'not opened' } : { end: 'not opened', host });
}

function namingTheHost(host: string) {
  return ({ end, code, host: named }: Pick<SocketEnded, 'end' | 'code' | 'host'>): SocketEnded => {
    const at = named ?? (end === 'not opened' ? host : undefined);
    return new SocketEnded({ end, ...(code === undefined ? {} : { code }), ...(at === undefined ? {} : { host: at }) });
  };
}

function sendingOfTheApp({ url }: Open, { credential, failureCodes }: SocketOpening, sending: Sending): BearerSending {
  const written = URL.parse(url);
  return {
    origins: written === null ? [] : [written.origin],
    bearer: { kind: 'key', token: credential },
    fetch: sending.fetch,
    reaches: sending.reaches,
    callMs: sending.callMs,
    mostRequestBytes: sending.mostRequestBytes,
    ...(failureCodes === undefined ? {} : { failureCodes }),
  };
}

function isARefusalOfTheValue(requested: RequestedOnce): boolean {
  return requested.kind === 'answered' && requested.outcome === 'server_failure' && requested.because === 'key_refused';
}

function isASocketAddress(address: Readonly<URL> | null): address is Readonly<URL> {
  return address !== null && address.protocol === 'wss:' && address.username === '' && address.password === '';
}

function socketAddressIn(requested: RequestedOnce, pointer: string): Readonly<URL> | undefined {
  if (requested.kind !== 'answered' || requested.outcome !== 'result') {
    return undefined;
  }
  const written = valueAt(requested.answer, pointer);
  const address = typeof written === 'string' ? URL.parse(written) : null;
  return isASocketAddress(address) ? address : undefined;
}

function reachedAt(address: Readonly<URL>, { reaches }: Sending): Effect.Effect<void, SocketEnded> {
  const unreached = () => notOpenedAt(address.hostname);
  return Effect.tryPromise({ try: () => Promise.resolve(reaches(address.href)), catch: unreached }).pipe(
    Effect.flatMap((refusal) => (refusal === undefined ? Effect.void : Effect.fail(unreached()))),
  );
}

export function opensAsDeclared({ sends, sending, constructs }: OpeningWays): OpensASocket {
  return (opening) =>
    Effect.gen(function* () {
      const { open } = opening.destination;
      if (open === undefined) {
        return yield* Effect.fail(notOpenedAt());
      }
      const requested = yield* sends({ method: open.method, url: open.url }, sendingOfTheApp(open, opening, sending));
      if (isARefusalOfTheValue(requested)) {
        return yield* Effect.fail(new SocketEnded({ end: 'refused' }));
      }
      const address = socketAddressIn(requested, open.address);
      if (address === undefined) {
        return yield* Effect.fail(notOpenedAt(URL.parse(open.url)?.hostname));
      }
      yield* reachedAt(address, sending);
      return yield* Effect.mapError(constructs(Redacted.make(address.href)), namingTheHost(address.hostname));
    });
}
