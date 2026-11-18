import { valueAt } from '@on.auto/definitions/tool-blocks';
import type { BearerSending, RequestedOnce } from '@on.auto/tool-servers';
import { Effect, Redacted } from 'effect';

import type { Destination } from '../events/destination-fields.ts';
import { SocketEnded, type ConstructsASocket, type OpensASocket, type SendsABearerRequest } from './socket-ports.ts';

export interface OpeningWays {
  readonly sends: SendsABearerRequest;
  readonly sending: Pick<BearerSending, 'fetch' | 'reaches' | 'callMs' | 'mostRequestBytes'>;
  readonly constructs: ConstructsASocket;
}

type Open = NonNullable<Destination['open']>;

type Sending = OpeningWays['sending'];

function notOpened(): SocketEnded {
  return new SocketEnded({ end: 'not opened' });
}

function sendingOfTheApp({ url }: Open, credential: Redacted.Redacted, sending: Sending): BearerSending {
  const written = URL.parse(url);
  return {
    origins: written === null ? [] : [written.origin],
    bearer: { kind: 'key', token: credential },
    fetch: sending.fetch,
    reaches: sending.reaches,
    callMs: sending.callMs,
    mostRequestBytes: sending.mostRequestBytes,
  };
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
  return Effect.tryPromise({ try: () => Promise.resolve(reaches(address.href)), catch: notOpened }).pipe(
    Effect.flatMap((refusal) => (refusal === undefined ? Effect.void : Effect.fail(notOpened()))),
  );
}

export function opensAsDeclared({ sends, sending, constructs }: OpeningWays): OpensASocket {
  return ({ destination: { open }, credential }) =>
    Effect.gen(function* () {
      if (open === undefined) {
        return yield* Effect.fail(notOpened());
      }
      const request = { method: open.method, url: open.url };
      const address = socketAddressIn(yield* sends(request, sendingOfTheApp(open, credential, sending)), open.address);
      if (address === undefined) {
        return yield* Effect.fail(notOpened());
      }
      yield* reachedAt(address, sending);
      return yield* constructs(Redacted.make(address.href));
    });
}
