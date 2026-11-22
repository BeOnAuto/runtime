import { createHash, randomBytes } from 'node:crypto';

import { Option, Schema } from 'effect';

/**
 * THE CONTRACT OF AUTO'S CONSENT SERVICE, as the runtime and Studio call it: one suite of cases, run on the fake
 * the runtime's tests use (`fakeConsentServiceAnswers`) and on the service itself, so the fake answers what the
 * service answers. Each side hands over its service as a fetch handler, the headers its callers send, the person's
 * consent at its vendor, a vendor whose next answer a case may choose, and a clock a case moves.
 */
export interface VendorAnswer {
  readonly status: number;
  readonly body: unknown;
}

/** The calls a service makes to its vendor: a code or a refresh token exchanged at its token endpoint, or a revocation. */
export type VendorCall = 'code' | 'refresh' | 'revoke';

export type VendorFetch = (...asked: readonly [unknown, unknown?]) => Promise<Response>;

export interface ControlledVendor {
  /** The vendor as the service reaches it, answering the next call a case chose and counting each. */
  readonly fetch: VendorFetch;
  readonly answerNext: (call: VendorCall, answer: VendorAnswer) => void;
  readonly called: (call: VendorCall) => number;
}

export interface ConsentServiceUnderTest {
  readonly handler: (request: Readonly<Request>) => Promise<Response>;
  /** The issuer the service has a client at, and a scope that client covers. */
  readonly issuer: string;
  readonly scope: string;
  /** The Studio the service sends a hosted consent back to, with its `/`. */
  readonly studioBase: string;
  /** The one address the service's client sends a person back to from the vendor. */
  readonly returnAddress: string;
  /** The headers the runtime's calls carry, and those of a person signed in to Studio. */
  readonly fromTheRuntime: Readonly<Record<string, string>>;
  readonly signedIn: () => Promise<Readonly<Record<string, string>>>;
  /** The person consents at the vendor to what the authorization URL asks, and the vendor answers a code. */
  readonly consentAt: (url: string) => Promise<string>;
  readonly vendor: ControlledVendor;
  readonly now: () => number;
  readonly advance: (ms: number) => void;
}

export type Made = () => Promise<ConsentServiceUnderTest>;

/** Each call by its form: the grant a token request names, or the token a revocation carries alone. */
const callsByForm: ReadonlyMap<string, VendorCall> = new Map([
  ['authorization_code', 'code'],
  ['refresh_token', 'refresh'],
  ['token:true', 'revoke'],
]);

const FormSchema = Schema.Struct({ body: Schema.Union([Schema.String, Schema.instanceOf(URLSearchParams)]) });

const decodeForm = Schema.decodeUnknownOption(FormSchema);

function callOf(init: unknown): VendorCall | undefined {
  const form = new URLSearchParams(Option.match(decodeForm(init), { onNone: () => '', onSome: ({ body }) => body }));
  return callsByForm.get(form.get('grant_type') ?? `token:${String(form.has('token'))}`);
}

/** A vendor reached through `fetch`, counting each call of the contract and answering the next one a case chose. */
export function controlledVendor(fetch: VendorFetch): ControlledVendor {
  const chosen = new Map<VendorCall | undefined, VendorAnswer>();
  const counts = new Map<VendorCall | undefined, number>();
  return {
    fetch: (...asked: readonly [unknown, unknown?]) => {
      const call = callOf(asked[1]);
      counts.set(call, (counts.get(call) ?? 0) + 1);
      const answer = chosen.get(call);
      chosen.delete(call);
      return answer === undefined ? fetch(...asked) : Promise.resolve(Response.json(answer.body, answer));
    },
    answerNext: (call, answer) => {
      chosen.set(call, answer);
    },
    called: (call) => counts.get(call) ?? 0,
  };
}

export const tenMinutesMs = 600_000;

export const loopback = { kind: 'loopback', base: 'http://127.0.0.1:5555/studio/' } as const;

const BodySchema = Schema.Record(Schema.String, Schema.Unknown);

const StartedSchema = Schema.Struct({ state: Schema.String, url: Schema.String, expires_at: Schema.String });

const HandleSchema = Schema.Struct({ handle: Schema.String });

const TakenSchema = Schema.Struct({
  connection_key: Schema.String,
  tokens: Schema.Struct({ refresh_token: Schema.String }),
});

const decodeBody = Schema.decodeUnknownOption(Schema.fromJsonString(BodySchema));

/** An answer's body: the fields the contract reads by name, and the rest it matches whole. */
interface AnswerBody {
  readonly clients?: unknown;
  readonly handle?: unknown;
  readonly refused?: unknown;
  readonly vendor_status?: unknown;
  readonly [field: string]: unknown;
}

export interface Answered {
  readonly status: number;
  readonly authenticate: string | null;
  readonly body: AnswerBody;
}

interface Pair {
  readonly verifier: string;
  readonly challenge: string;
}

export function pairOf(): Pair {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

interface Sending {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export async function sent(service: ConsentServiceUnderTest, path: string, sending: Sending = {}): Promise<Answered> {
  const answer = await service.handler(new Request(`https://consents.example.com${path}`, sending));
  const body = Option.getOrElse(decodeBody(await answer.text()), () => ({}));
  return { status: answer.status, authenticate: answer.headers.get('www-authenticate'), body };
}

export function posted(
  service: ConsentServiceUnderTest,
  path: string,
  body: unknown,
  headers: Readonly<Record<string, string>>,
): Promise<Answered> {
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
  return sent(service, path, init);
}

export function fromTheRuntime(service: ConsentServiceUnderTest, path: string, body: unknown): Promise<Answered> {
  return posted(service, path, body, service.fromTheRuntime);
}

export async function started(service: ConsentServiceUnderTest, asked: Readonly<Record<string, unknown>> = {}) {
  const pair = pairOf();
  const answered = await fromTheRuntime(service, '/consents', {
    issuer: service.issuer,
    scope: service.scope,
    return: loopback,
    challenge: pair.challenge,
    challenge_method: 'S256',
    ...asked,
  });
  return { answered, pair, start: Schema.decodeUnknownSync(StartedSchema)(answered.body) };
}

export async function redeemOf(service: ConsentServiceUnderTest, state: string, code: string): Promise<Answered> {
  return posted(service, `/consents/${encodeURIComponent(state)}/redeem`, { code }, await service.signedIn());
}

export function takeOf(service: ConsentServiceUnderTest, handle: string, verifier: string): Promise<Answered> {
  return fromTheRuntime(service, `/handoffs/${encodeURIComponent(handle)}`, { verifier });
}

export async function redeemed(service: ConsentServiceUnderTest) {
  const { pair, start } = await started(service);
  const answered = await redeemOf(service, start.state, await service.consentAt(start.url));
  return { pair, handle: Schema.decodeUnknownSync(HandleSchema)(answered.body).handle };
}

export async function connected(service: ConsentServiceUnderTest) {
  const { pair, handle } = await redeemed(service);
  const taken = Schema.decodeUnknownSync(TakenSchema)((await takeOf(service, handle, pair.verifier)).body);
  return {
    issuer: service.issuer,
    refresh_token: taken.tokens.refresh_token,
    connection_key: taken.connection_key,
  };
}
