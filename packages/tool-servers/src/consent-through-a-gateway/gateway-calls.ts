import type { FetchLike } from '@modelcontextprotocol/client';
import { withoutTrailingSlashes } from '@on.auto/config';
import { Effect, Option, Redacted, Schema } from 'effect';

import { ClientIdSchema } from '../consent/client-sources.ts';
import { refusalOf, type RequestRefusal } from '../consent/consent-failures.ts';
import { isScope } from '../consent/scopes.ts';

export interface GatewayRequesting {
  readonly fetch: FetchLike;
  readonly url: string;
}

const GivenSchema = Schema.String.check(Schema.isMinLength(1));

const mostAccountCharacters = 256;

const AccountPartSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(mostAccountCharacters));

const isAnAccountPart = Schema.is(AccountPartSchema);

export interface ConnectedAccount {
  readonly id: string;
  readonly name?: string;
}

const GatewayStartedSchema = Schema.Struct({ url: GivenSchema, expires_at: GivenSchema, client_id: ClientIdSchema });

const ScopeSchema = Schema.String.check(
  Schema.makeFilter((text: string) => isScope(text) || 'Expected scopes separated by single spaces'),
);

const HandedKeySchema = Schema.Struct({ connection_key: GivenSchema });

const ConnectedSchema = Schema.Struct({
  account: Schema.Struct({ id: AccountPartSchema, name: Schema.optionalKey(Schema.Unknown) }),
  scope: Schema.optionalKey(ScopeSchema),
});

const ProblemSchema = Schema.Struct({ refused: Schema.String });

type GatewayStarted = typeof GatewayStartedSchema.Type;

interface Connected {
  readonly account: ConnectedAccount;
  readonly scope?: string;
}

interface HandedOver {
  readonly key: Redacted.Redacted;
  readonly connected: Option.Option<Connected>;
}

type GatewayStartRefusal = RequestRefusal | { readonly refused: 'start_refused' };

type GatewayHandoffRefusal = RequestRefusal | { readonly refused: 'code' };

interface StartAskedOfAGateway {
  readonly challenge: string;
  readonly state: string;
}

export interface GatewayCalls {
  readonly start: (asked: StartAskedOfAGateway) => Effect.Effect<GatewayStarted, GatewayStartRefusal>;
  readonly takeHandoff: (
    handle: string,
    verifier: Redacted.Redacted,
  ) => Effect.Effect<HandedOver, GatewayHandoffRefusal>;
  readonly end: (key: Redacted.Redacted) => Effect.Effect<void, RequestRefusal>;
}

interface Answered {
  readonly status: number;
  readonly text: string;
}

const unanswered: RequestRefusal = { refused: 'unanswered' };

const handleRefused: GatewayHandoffRefusal = { refused: 'code' };

const challengeMethod = 'S256';

const status = { ok: 200, created: 201, refused: 400, forbidden: 403, notFound: 404, conflict: 409 } as const;

const unknownKey = 'unknown_key';

const decodeStarted = Schema.decodeUnknownOption(Schema.fromJsonString(GatewayStartedSchema));

const decodeHandedKey = Schema.decodeUnknownOption(Schema.fromJsonString(HandedKeySchema));

const decodeConnected = Schema.decodeUnknownOption(Schema.fromJsonString(ConnectedSchema));

const decodeProblem = Schema.decodeUnknownOption(Schema.fromJsonString(ProblemSchema));

function sent({ fetch }: GatewayRequesting, address: string, body: unknown): Effect.Effect<Answered, RequestRefusal> {
  return Effect.tryPromise({
    try: async () => {
      const answer = await fetch(address, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'manual',
      });
      return { status: answer.status, text: await answer.text() };
    },
    catch: refusalOf,
  });
}

function decodedAs<A>(
  decode: (text: string) => Option.Option<A>,
  { text }: Answered,
): Effect.Effect<A, RequestRefusal> {
  return Option.match(decode(text), {
    onNone: () => Effect.fail(unanswered),
    onSome: (decoded) => Effect.succeed(decoded),
  });
}

function refusedWordOf({ text }: Answered): string | undefined {
  return Option.getOrUndefined(Option.map(decodeProblem(text), ({ refused }) => refused));
}

function started(answered: Answered): Effect.Effect<GatewayStarted, GatewayStartRefusal> {
  if (answered.status === status.refused) {
    return Effect.fail({ refused: 'start_refused' });
  }
  return answered.status === status.created ? decodedAs(decodeStarted, answered) : Effect.fail(unanswered);
}

function isARefusedHandle(answered: Answered): boolean {
  if (answered.status === status.notFound) {
    return true;
  }
  const refusesWithAWord = answered.status === status.forbidden || answered.status === status.conflict;
  return refusesWithAWord && refusedWordOf(answered) !== undefined;
}

function accountOf(id: string, name: unknown): ConnectedAccount {
  return isAnAccountPart(name) ? { id, name } : { id };
}

function connectedIn({ text }: Answered): Option.Option<Connected> {
  return Option.map(decodeConnected(text), ({ account, scope }) => ({
    account: accountOf(account.id, account.name),
    ...(scope === undefined ? {} : { scope }),
  }));
}

function handedOver(answered: Answered): Effect.Effect<HandedOver, GatewayHandoffRefusal> {
  if (answered.status !== status.ok) {
    return Effect.fail(isARefusedHandle(answered) ? handleRefused : unanswered);
  }
  return Effect.map(decodedAs(decodeHandedKey, answered), ({ connection_key: key }) => ({
    key: Redacted.make(key),
    connected: connectedIn(answered),
  }));
}

function isEnded(answered: Answered): boolean {
  const done = answered.status >= status.ok && answered.status < 300;
  return done || (answered.status === status.forbidden && refusedWordOf(answered) === unknownKey);
}

function ended(answered: Answered): Effect.Effect<void, RequestRefusal> {
  return isEnded(answered) ? Effect.void : Effect.fail(unanswered);
}

export function gatewayCallsOf(requesting: GatewayRequesting): GatewayCalls {
  const base = withoutTrailingSlashes(requesting.url);
  const send = (path: string, body: unknown) => sent(requesting, `${base}${path}`, body);
  return {
    start: ({ challenge, state }) =>
      Effect.flatMap(send('', { challenge, challenge_method: challengeMethod, state }), started),
    takeHandoff: (handle, verifier) =>
      Effect.flatMap(
        send(`/handoffs/${encodeURIComponent(handle)}`, { verifier: Redacted.value(verifier) }),
        handedOver,
      ),
    end: (key) => Effect.flatMap(send('/remove', { connection_key: Redacted.value(key) }), ended),
  };
}
