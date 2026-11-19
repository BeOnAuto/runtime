import { bearerRequestOnce, type RequestedOnce } from '@on.auto/tool-servers';
import { Effect, Function, Option, Redacted } from 'effect';

import { eventDestinationOf } from '../reading/provider-list.ts';
import { opensAsDeclared, type OpeningWays } from '../sockets/socket-openings.ts';
import type { OpenSocket, SendsABearerRequest, SocketEnded, SocketOpening } from '../sockets/socket-ports.ts';
import { overASocket, trackerOverASocket } from './event-destinations.ts';
import { providersOf } from './fixture-providers.ts';

type Destination = SocketOpening['destination'];

type Sending = OpeningWays['sending'];

export type Refusal = ReturnType<Sending['reaches']>;

type Ended = Pick<SocketEnded, 'end' | 'code' | 'host'>;

export function destinationOf(declared: object, type: 'webhook' | 'websocket'): Destination {
  const entry = { ...trackerOverASocket, events: { destinations: [declared] } };
  return Option.getOrThrow(Option.fromNullishOr(eventDestinationOf(providersOf(entry), 'tracker', type)));
}

export const theOpening = 'https://api.chat.example.com/connections.open';

export const theAppsValue = 'app-value-4b8e1d07';

export const theTicket = 'ticket-9f2c6a31';

export const theAddress = `wss://socket.chat.example.com/link/?ticket=${theTicket}&app_id=A1`;

export const theAddressAs = (scheme: string) => theAddress.replace('wss:', scheme);

const overTheSocket = destinationOf(overASocket, 'websocket');

export const failureCodes = { succeeded: '/ok', code: '/error', key_refused: ['invalid_auth', 'token_revoked'] };

export function openedAt(url: string, method: 'GET' | 'POST' = 'POST'): Destination {
  return { ...overTheSocket, open: { method, url, address: '/url' } };
}

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly redirect: string;
}

interface Opened {
  readonly ended: Ended | undefined;
  readonly sent: readonly Sent[];
  readonly reached: readonly string[];
  readonly constructed: readonly Redacted.Redacted[];
  readonly closed: number;
}

interface Setting {
  readonly answer?: () => Response;
  readonly destination?: Destination;
  readonly unreached?: (url: string) => Refusal;
  readonly sends?: SendsABearerRequest;
  readonly besideTheSending?: Readonly<Record<string, unknown>>;
  readonly failureCodes?: SocketOpening['failureCodes'];
  readonly constructed?: (address: Redacted.Redacted) => Effect.Effect<OpenSocket, SocketEnded>;
}

export type Traced = (opening: Effect.Effect<Ended | undefined>) => Effect.Effect<Ended | undefined>;

interface Service {
  readonly fetch: Sending['fetch'];
  readonly sent: () => readonly Sent[];
}

const aSocket: OpenSocket = { next: Effect.never, send: Function.constant(Effect.void), ping: Effect.void };

export const answering = (body: unknown) => () => Response.json(body);

function serviceAnswering(answer: () => Response): Service {
  const sent: Sent[] = [];
  return {
    fetch: async (...[address, init]: readonly [unknown, unknown?]) => {
      const request = new Request(String(address), Object.assign({}, init));
      const { url, method, redirect } = request;
      sent.push({ url, method, headers: Object.fromEntries(request.headers), body: await request.text(), redirect });
      return answer();
    },
    sent: () => [...sent],
  };
}

export async function opened(setting: Setting, traced: Traced = Function.identity): Promise<Opened> {
  const reached: string[] = [];
  const constructed: Redacted.Redacted[] = [];
  let closed = 0;
  const { answer = answering({ ok: true, url: theAddress }), unreached = Function.constUndefined } = setting;
  const service = serviceAnswering(answer);
  const reaches = (url: string): Refusal => {
    reached.push(url);
    return unreached(url);
  };
  const sending = { fetch: service.fetch, reaches, callMs: 30_000, mostRequestBytes: 65_536 };
  const opens = opensAsDeclared({
    sends: setting.sends ?? bearerRequestOnce,
    sending: Object.assign(sending, setting.besideTheSending),
    constructs: (address) =>
      Effect.sync(() => constructed.push(address)).pipe(
        Effect.andThen(setting.constructed?.(address) ?? Effect.succeed(aSocket)),
        Effect.andThen(
          Effect.addFinalizer(() =>
            Effect.sync(() => {
              closed += 1;
            }),
          ),
        ),
        Effect.as(aSocket),
      ),
  });
  const opening = {
    destination: setting.destination ?? overTheSocket,
    credential: Redacted.make(theAppsValue),
    ...(setting.failureCodes === undefined ? {} : { failureCodes: setting.failureCodes }),
  };
  const ended = await Effect.runPromise(
    traced(
      Effect.scoped(opens(opening)).pipe(
        Effect.match({ onFailure: (end: Ended) => end, onSuccess: Function.constUndefined }),
      ),
    ),
  );
  return { ended, sent: service.sent(), reached, constructed, closed };
}

export const notOpened = 'not opened';

export const endOf = (ended: Ended | undefined) => ended?.end ?? 'opened';

export const unopened: RequestedOnce = { kind: 'unopened', because: 'connection_not_allowed' };
