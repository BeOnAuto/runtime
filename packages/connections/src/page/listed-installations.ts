import { Conflict, Unavailable } from '@on.auto/operations';
import { boundedAnswerOf, fetchWithin } from '@on.auto/outbound';
import { accountNamePlaceholder, type Installation } from '@on.auto/providers';
import { keptTokensIn, registeredClientNamed, valueAt } from '@on.auto/tool-servers';
import { Effect, Function, Option, Schema, type Redacted } from 'effect';

import { fetchOfTheCall } from '../operations/admitted-additions.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { reachesUnder } from '../policy/policy-rules.ts';
import type { Installed, ListedInstallation, RecordedConnection } from '../registry/connection.ts';

export type Listing = Pick<ConnectionServices, 'fetch' | 'policy' | 'resolve' | 'registeredClients'>;

const mostListingBytes = 1_048_576;

const noMembershipStatuses: ReadonlySet<number> = new Set([403, 404]);

const listOf = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));

const answerOfText = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

type Conditions = Installation['membership']['admin'];

interface Reached extends Installed {
  readonly account: string | undefined;
  readonly personal: boolean;
}

interface Answered {
  readonly ok: boolean;
  readonly status: number;
  readonly text: string;
}

interface Asked {
  readonly method: string;
  readonly url: string;
}

type Refusal = () => Unavailable;

type Asking = (asked: Asked, unanswered: Refusal) => Effect.Effect<Answered, Unavailable>;

function textAt(item: unknown, pointer: string): string | undefined {
  const value = valueAt(item, pointer);
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function isHeld(answer: unknown, pointer: string, values: Conditions[string]): boolean {
  const value = valueAt(answer, pointer) ?? null;
  return values.some((each) => each === value);
}

function holdsEvery(answer: unknown, conditions: Conditions): boolean {
  return Object.entries(conditions).every(([pointer, values]: readonly [string, Conditions[string]]) =>
    isHeld(answer, pointer, values),
  );
}

function reachedOf(item: unknown, installations: Installation['installations']): readonly Reached[] {
  const [installed, named] = [textAt(item, installations.id), textAt(item, installations.name)];
  if (installed === undefined || named === undefined) {
    return [];
  }
  const account = textAt(item, installations.account);
  return [{ id: installed, name: named, account, personal: holdsEvery(item, installations.personal) }];
}

function installationsIn(
  answer: unknown,
  installations: Installation['installations'],
): Option.Option<readonly Reached[]> {
  return Option.map(listOf(valueAt(answer, installations.list)), (items) =>
    items.flatMap((item) => reachedOf(item, installations)),
  );
}

function unlistedOf(name: string): Unavailable {
  return new Unavailable({
    detail: `The service did not say which installations the person who signed in can reach, so the connection ${name} was not connected. Try again.`,
  });
}

function unconfirmedOf(name: string): Unavailable {
  return new Unavailable({
    detail: `The service did not confirm whether the person who signed in administers the accounts of these installations, so the connection ${name} was not connected. Try again.`,
  });
}

async function answeredTo(fetched: Promise<Response>): Promise<Answered> {
  const response = await fetched;
  const text = await boundedAnswerOf(response, mostListingBytes, Function.constVoid).text();
  return { ok: response.ok, status: response.status, text };
}

function askingWith(tokens: Redacted.Redacted, services: Listing): Effect.Effect<Asking> {
  return Effect.map(fetchOfTheCall(services.fetch), (own) => {
    const fetch = fetchWithin(own, reachesUnder(services.policy, services.resolve));
    const token = Option.getOrThrow(keptTokensIn(tokens));
    const headers = { authorization: `Bearer ${token.access_token}`, accept: 'application/json' };
    return ({ method, url }, unanswered) =>
      Effect.tryPromise({ try: () => answeredTo(fetch(url, { method, headers })), catch: unanswered });
  });
}

function documentOf({ ok, text }: Answered): Option.Option<unknown> {
  return ok ? answerOfText(text) : Option.none();
}

function personOf(
  asking: Asking,
  userinfo: Installation['userinfo'],
  unconfirmed: Refusal,
): Effect.Effect<string, Unavailable> {
  return Effect.flatMap(asking(userinfo, unconfirmed), (answered) =>
    Option.match(
      Option.flatMap(documentOf(answered), (answer) => Option.fromNullishOr(textAt(answer, userinfo.id))),
      { onNone: () => Effect.fail(unconfirmed()), onSome: Effect.succeed },
    ),
  );
}

function isAnAdminAnswer(answered: Answered, admin: Conditions): Option.Option<boolean> {
  if (!answered.ok) {
    return noMembershipStatuses.has(answered.status) ? Option.some(false) : Option.none();
  }
  return Option.map(answerOfText(answered.text), (answer) => holdsEvery(answer, admin));
}

function isAnAdminOf(
  asking: Asking,
  { name }: Reached,
  membership: Installation['membership'],
  unconfirmed: Refusal,
): Effect.Effect<boolean, Unavailable> {
  const url = membership.url.replace(`{${accountNamePlaceholder}}`, encodeURIComponent(name));
  return Effect.flatMap(asking({ method: membership.method, url }, unconfirmed), (answered) =>
    Option.match(isAnAdminAnswer(answered, membership.admin), {
      onNone: () => Effect.fail(unconfirmed()),
      onSome: Effect.succeed,
    }),
  );
}

const listedWith = Effect.fnUntraced(function* (
  asking: Asking,
  reached: readonly Reached[],
  { userinfo, membership }: Installation,
  unconfirmed: Refusal,
) {
  const person = yield* Effect.cached(personOf(asking, userinfo, unconfirmed));
  const adminOf = (each: Reached): Effect.Effect<boolean, Unavailable> =>
    each.personal
      ? Effect.map(person, (id) => each.account !== undefined && each.account === id)
      : isAnAdminOf(asking, each, membership, unconfirmed);
  return yield* Effect.forEach(
    reached,
    (each) => Effect.map(adminOf(each), (admin): ListedInstallation => ({ id: each.id, name: each.name, admin })),
    { concurrency: 'unbounded' },
  );
});

interface Listed {
  readonly installation: Installation;
  readonly chosen?: string | undefined;
}

export function installationsListedFor(
  name: string,
  { tokens }: { readonly tokens: Redacted.Redacted },
  { installation, chosen }: Listed,
  services: Listing,
): Effect.Effect<readonly ListedInstallation[], Unavailable> {
  const { installations } = installation;
  const unlisted = () => unlistedOf(name);
  return Effect.gen(function* () {
    const asking = yield* askingWith(tokens, services);
    const answered = yield* asking(installations, unlisted);
    const listed = Option.flatMap(documentOf(answered), (answer) => installationsIn(answer, installations));
    const reached = yield* Option.match(listed, { onNone: () => Effect.fail(unlisted()), onSome: Effect.succeed });
    const asked = chosen === undefined ? reached : reached.filter(({ id }) => id === chosen);
    return yield* listedWith(asking, asked, installation, () => unconfirmedOf(name));
  });
}

function unsetUpOf(name: string): Conflict {
  return new Conflict({
    detail: `The application the connection ${name} installs is no longer set up on this runtime, so it cannot be connected this way.`,
  });
}

export function installPageOf(
  { name, credential }: Pick<RecordedConnection, 'name' | 'credential'>,
  { clientId, state }: { readonly clientId: string; readonly state: string },
  { registeredClients = [] }: Pick<Listing, 'registeredClients'>,
): Effect.Effect<string, Conflict> {
  const page = registeredClientNamed(registeredClients, String(credential.issuer), clientId)?.application?.installPage;
  if (page === undefined) {
    return Effect.fail(unsetUpOf(name));
  }
  const address = new URL(page);
  address.searchParams.set('state', state);
  return Effect.succeed(address.href);
}
