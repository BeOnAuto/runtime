import { createHash, randomBytes } from 'node:crypto';

import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { FetchHandler } from '../testing/fetch-handler.ts';

/** A step of a connection through a gateway, whose call may carry a note of the caller the gateway checks. */
export type ConnectionGatewayStep = 'start' | 'handoff' | 'end' | 'call';

/**
 * A connection gateway as one side of the contract runs it, with what legitimately differs between sides as settings:
 * where it answers, the header its calls carry their key in, a call it answers for a key it handed over, the headers
 * of the caller's note each step carries (none, where a side takes no note), and how the outside provider's consent
 * is given as the person, which ends at the handle the gateway hands back.
 */
export interface ConnectionGatewayUnderTest {
  readonly handler: FetchHandler;
  /** The address a connection starts at; its hand-offs and its end are under it. */
  readonly connections: string;
  /** The address the calls of a connection are under. */
  readonly calls: string;
  readonly keyHeader: string;
  /** A call, under `calls`, that the gateway answers 200 for a key it handed over. */
  readonly aCall: { readonly method: string; readonly path: string };
  readonly noted: (step: ConnectionGatewayStep) => Promise<Readonly<Record<string, string>>>;
  /** The person's consent at the provider, given at the start's address: the handle the gateway hands back for it. */
  readonly consentAt: (startUrl: string) => Promise<string>;
}

export type MadeConnectionGateway = () => Promise<ConnectionGatewayUnderTest>;

/** An answer's body: the fields the contract reads by name, and the rest it matches whole. */
interface AnswerBody {
  readonly url?: unknown;
  readonly expires_at?: unknown;
  readonly client_id?: unknown;
  readonly connection_key?: unknown;
  readonly refused?: unknown;
  readonly [field: string]: unknown;
}

interface Answered {
  readonly status: number;
  readonly body: AnswerBody;
  /** The `WWW-Authenticate` of the answer, `'null'` where it has none. */
  readonly authenticate: string;
}

/** A JSON object's fields: an empty answer, or one of another kind, has none. */
const aString: unknown = expect.any(String);

const decodeBody = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));

async function sent(
  gateway: ConnectionGatewayUnderTest,
  step: ConnectionGatewayStep,
  address: string,
  init: { readonly method: string; readonly body?: unknown; readonly headers?: Readonly<Record<string, string>> },
): Promise<Answered> {
  const headers = { 'content-type': 'application/json', ...(await gateway.noted(step)), ...init.headers };
  const answer = await gateway.handler(
    new Request(address, {
      method: init.method,
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  );
  const body = Option.getOrElse(decodeBody(await answer.text()), () => ({}));
  return { status: answer.status, body, authenticate: String(answer.headers.get('www-authenticate')) };
}

interface Pair {
  readonly verifier: string;
  readonly challenge: string;
}

/** A verifier of 43 characters and its S256 challenge, as the runtime makes them. */
function pairOf(): Pair {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

const stateOf = (): string => randomBytes(32).toString('base64url');

const startOf = (gateway: ConnectionGatewayUnderTest, body: Readonly<Record<string, unknown>>) =>
  sent(gateway, 'start', gateway.connections, { method: 'POST', body });

async function started(gateway: ConnectionGatewayUnderTest): Promise<{ readonly url: string; readonly pair: Pair }> {
  const pair = pairOf();
  const answered = await startOf(gateway, { challenge: pair.challenge, challenge_method: 'S256', state: stateOf() });
  expect(answered.status).toBe(201);
  return { url: String(answered.body.url), pair };
}

const handedOver = (gateway: ConnectionGatewayUnderTest, handle: string, verifier: string) =>
  sent(gateway, 'handoff', `${gateway.connections}/handoffs/${encodeURIComponent(handle)}`, {
    method: 'POST',
    body: { verifier },
  });

async function connected(gateway: ConnectionGatewayUnderTest): Promise<string> {
  const { url, pair } = await started(gateway);
  const answered = await handedOver(gateway, await gateway.consentAt(url), pair.verifier);
  expect(answered.status).toBe(200);
  return String(answered.body.connection_key);
}

const ended = (gateway: ConnectionGatewayUnderTest, key: string) =>
  sent(gateway, 'end', `${gateway.connections}/remove`, { method: 'POST', body: { connection_key: key } });

const called = (gateway: ConnectionGatewayUnderTest, key: string) =>
  sent(gateway, 'call', `${gateway.calls}${gateway.aCall.path}`, {
    method: gateway.aCall.method,
    headers: { [gateway.keyHeader]: key },
  });

function startsOfConnections(made: MadeConnectionGateway): void {
  it('starts a connection, 201, with the address to send the person to, when the start ends and the client it is made with', async () => {
    const gateway = await made();
    const pair = pairOf();
    const answered = await startOf(gateway, { challenge: pair.challenge, challenge_method: 'S256', state: stateOf() });
    expect(answered.status).toBe(201);
    expect([
      new URL(String(answered.body.url)).protocol,
      Number.isFinite(Date.parse(String(answered.body.expires_at))),
      typeof answered.body.client_id,
    ]).toEqual(['https:', true, 'string']);
  });

  it.each([
    ['a challenge method other than S256', { challenge_method: 'plain' }],
    ['a challenge that is no S256 of a verifier', { challenge: 'short' }],
    ['a state of another shape than the runtime makes', { state: 'short' }],
  ])('refuses a start with %s, 400', async (_: string, asked: Readonly<Record<string, unknown>>) => {
    const gateway = await made();
    const pair = pairOf();
    const answered = await startOf(gateway, {
      challenge: pair.challenge,
      challenge_method: 'S256',
      state: stateOf(),
      ...asked,
    });
    expect(answered.status).toBe(400);
  });
}

function handOffs(made: MadeConnectionGateway): void {
  it('hands a connection over once, to the verifier whose challenge began it, with its key and its account', async () => {
    const gateway = await made();
    const { url, pair } = await started(gateway);
    const handle = await gateway.consentAt(url);
    const first = await handedOver(gateway, handle, pair.verifier);
    const second = await handedOver(gateway, handle, pair.verifier);
    expect(first).toMatchObject({
      status: 200,
      body: { connection_key: aString, account: { id: aString } },
    });
    expect(second.status).toBe(404);
  });

  it('refuses a verifier whose challenge did not begin the connection, 403 wrong_verifier, and hands it over to the right one after', async () => {
    const gateway = await made();
    const { url, pair } = await started(gateway);
    const handle = await gateway.consentAt(url);
    const wrong = await handedOver(gateway, handle, pairOf().verifier);
    const right = await handedOver(gateway, handle, pair.verifier);
    expect([wrong.status, wrong.body.refused, right.status]).toEqual([403, 'wrong_verifier', 200]);
  });

  it('answers a handle it never gave, 404', async () => {
    const gateway = await made();
    const answered = await handedOver(gateway, randomBytes(32).toString('base64url'), pairOf().verifier);
    expect(answered.status).toBe(404);
  });
}

function callsAndEnds(made: MadeConnectionGateway): void {
  it('takes a call that carries the key it handed over', async () => {
    const gateway = await made();
    const answered = await called(gateway, await connected(gateway));
    expect(answered.status).toBe(200);
  });

  it('ends a connection once, 204, and refuses its key to end it again, 403 unknown_key', async () => {
    const gateway = await made();
    const key = await connected(gateway);
    const first = await ended(gateway, key);
    const again = await ended(gateway, key);
    expect([first.status, again.status, again.body.refused]).toEqual([204, 403, 'unknown_key']);
  });

  it('refuses a call with the key of a connection that ended, 401 invalid_token', async () => {
    const gateway = await made();
    const key = await connected(gateway);
    expect((await ended(gateway, key)).status).toBe(204);
    const answered = await called(gateway, key);
    expect([answered.status, answered.authenticate.includes('invalid_token')]).toEqual([401, true]);
  });
}

/**
 * THE CONTRACT OF A CONNECTION GATEWAY, as the runtime calls one to connect a person's account at an outside provider:
 * the same cases run on each fake of a gateway and on a gateway itself, so a fake answers what a gateway answers.
 */
export function connectionGatewayBehaviour(name: string, made: MadeConnectionGateway): void {
  describe(`a connection gateway: ${name}`, () => {
    startsOfConnections(made);
    handOffs(made);
    callsAndEnds(made);
  });
}
